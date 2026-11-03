import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  ApproveProjectLifecycleRequestResponse,
  ListProjectLifecycleRequestsResponse,
  RejectProjectLifecycleRequestResponse,
} from "@workspace/api-zod";
import { assertResponseShape } from "@/shared/assertResponseShape";
import {
  approveLifecycleRequest,
  deleteLifecycleRequest,
  getLifecycleRequestById,
  listLifecycleRequests,
  listLifecycleRequestsForUser,
  rejectLifecycleRequest,
} from "@/features/projects/infrastructure/projectLifecycleRequestService";
import {
  clearProjectFiles,
  deleteProject,
  listAvailableProjects,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import {
  getPendingClearFilesRequestForProject,
  getPendingDeleteRequestForProject,
} from "@/features/projects/infrastructure/lifecycleRequestService";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import {
  enforceProjectOrgAccess,
  resolveScopePolicy,
} from "@/features/auth/infrastructure/orgScope";
import { getApprovalContext } from "@/features/projects/infrastructure/approvalBypass";
import { requireRole } from "@/shared/middlewares/requireRole";
import { getEffectiveRole } from "@/shared/middlewares/effectiveRole";
import { createAssignment, isAssigned } from "@/features/assignments/infrastructure/assignmentService";
import {
  db,
  projectOrganizationsTable,
  projectAssignmentsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { serializeLifecycleRequest } from "./_serializer";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

const IdParam = z.object({ id: z.string().uuid() });
const StatusFilter = z.enum(["pending", "approved", "rejected"]).optional();
const DecisionBody = z.object({
  note: z.string().trim().max(2000).optional(),
});

router.get(
  "/projects/lifecycle-requests",
  async (req, res): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsedStatus = StatusFilter.safeParse(req.query.status);
    if (!parsedStatus.success) {
      res.status(400).json({ error: "Invalid status filter" });
      return;
    }
    const mine =
      req.query.mine === "true" || req.query.mine === "1";
    // Authorize on the *effective* (per-org) role — task #36. SSO
    // users carry `users.role = 'limited'` globally; only the resolver
    // returns their true authority for the active org.
    const effective = (await getEffectiveRole(req)) ?? user.role;
    const isElevated =
      effective === "admin" || effective === "memento_admin";
    if (mine || !isElevated) {
      const rows = await listLifecycleRequestsForUser(user.id);
      const filtered = parsedStatus.data
        ? rows.filter((r) => r.status === parsedStatus.data)
        : rows;
      res.json(
        assertResponseShape(
          ListProjectLifecycleRequestsResponse,
          filtered.map(serializeLifecycleRequest),
          "GET /projects/lifecycle-requests",
        ),
      );
      return;
    }
    const policy = await resolveScopePolicy(req);
    if (policy.kind === "none") {
      res.json([]);
      return;
    }
    const rows = await listLifecycleRequests({
      status: parsedStatus.data,
      ...(policy.kind === "org"
        ? { orgScope: { orgId: policy.orgId } }
        : {}),
    });
    res.json(
      assertResponseShape(
        ListProjectLifecycleRequestsResponse,
        rows.map(serializeLifecycleRequest),
        "GET /projects/lifecycle-requests",
      ),
    );
  },
);

async function ensureAdminCanDecide(
  req: import("express").Request,
  res: import("express").Response,
  id: string,
): Promise<{
  row: Awaited<ReturnType<typeof getLifecycleRequestById>>;
} | null> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  // Authorize on the *effective* (per-org) role — task #36.
  const effective = (await getEffectiveRole(req)) ?? user.role;
  if (effective !== "admin" && effective !== "memento_admin") {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  const row = await getLifecycleRequestById(id);
  if (!row) {
    res.status(404).json({ error: "Request not found" });
    return null;
  }
  // No self-approval for non-memento admins on their own requests.
  if (
    row.requestedByUserId === user.id &&
    effective !== "memento_admin"
  ) {
    res.status(403).json({ error: "You cannot decide your own request" });
    return null;
  }
  // Org scope: admins only decide requests in their active org.
  const policy = await resolveScopePolicy(req);
  if (policy.kind === "org") {
    const stamp = await db
      .select()
      .from(projectOrganizationsTable)
      .where(eq(projectOrganizationsTable.projectName, row.projectName))
      .limit(1);
    const projOrg = stamp[0]?.organizationId ?? null;
    const rowOrg = row.organizationId ?? null;
    if (projOrg !== policy.orgId && rowOrg !== policy.orgId) {
      res.status(404).json({ error: "Request not found" });
      return null;
    }
  } else if (policy.kind === "none") {
    res.status(404).json({ error: "Request not found" });
    return null;
  }
  return { row };
}

router.post(
  "/projects/lifecycle-requests/:id/approve",
  async (req, res): Promise<void> => {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const ok = await ensureAdminCanDecide(req, res, parsed.data.id);
    if (!ok || !ok.row) return;
    const body = DecisionBody.safeParse(req.body ?? {});
    if (!body.success) {
      respondValidationError(res, body.error);
      return;
    }
    if (ok.row.status !== "pending") {
      res.status(400).json({ error: "Request has already been decided" });
      return;
    }
    try {
      // Side effects FIRST, status flip LAST. If a side effect fails,
      // the request stays pending so an admin can retry. All writes
      // here are idempotent.
      const pre = ok.row;
      if (pre.kind === "create") {
        // Use the requester's *effective* role captured at request
        // time (`requestedByRole`) — task #36. Reading
        // `users.role` here would misclassify SSO requesters, whose
        // global column was demoted to `limited` by the per-org-roles
        // foundation even when they acted as an in-org Admin.
        const role = pre.requestedByRole;
        if (role === "limited_admin" || role === "limited") {
          const already = await isAssigned(
            pre.requestedByUserId,
            pre.projectName,
          );
          if (!already) {
            await createAssignment({
              userId: pre.requestedByUserId,
              projectName: pre.projectName,
              assignedBy: req.user!.id,
              organizationId: pre.organizationId ?? undefined,
            });
          }
        }
      } else if (pre.kind === "delete") {
        // Execute the destructive delete BEFORE flipping the status so
        // a failed delete keeps the request pending (admin can retry).
        const available = await listAvailableProjects();
        const target = available.find(
          (p) => p.solutionName === pre.projectName,
        );
        if (!target) {
          res.status(409).json({
            error: `Project '${pre.projectName}' is no longer available; cannot approve delete.`,
          });
          return;
        }
        await deleteProject(target.slnPath);
        await db
          .delete(projectOrganizationsTable)
          .where(eq(projectOrganizationsTable.projectName, pre.projectName));
      } else if (pre.kind === "clear_files") {
        // Execute the clear BEFORE flipping the status so a failed
        // clear keeps the request pending (admin can retry).
        const available = await listAvailableProjects();
        const target = available.find(
          (p) => p.solutionName === pre.projectName,
        );
        if (!target) {
          res.status(409).json({
            error: `Project '${pre.projectName}' is no longer available; cannot approve clear-files.`,
          });
          return;
        }
        await clearProjectFiles(target.slnPath);
      }
      const updated = await approveLifecycleRequest({
        id: parsed.data.id,
        decidedBy: req.user!.id,
        note: body.data.note ?? null,
      });
      if (pre.kind === "delete") {
        await recordAudit({
          user: { id: req.user!.id },
          project: updated.projectName,
          action: "project_delete_approved",
          details: {
            requestId: updated.id,
            requestedBy: updated.requestedByUsername,
          },
        });
        await recordAudit({
          user: { id: req.user!.id },
          project: updated.projectName,
          action: "project_delete_executed",
          details: { requestId: updated.id, via: "approval" },
        });
      } else if (pre.kind === "clear_files") {
        await recordAudit({
          user: { id: req.user!.id },
          project: updated.projectName,
          action: "project_clear_files_approved",
          details: {
            requestId: updated.id,
            requestedBy: updated.requestedByUsername,
          },
        });
        await recordAudit({
          user: { id: req.user!.id },
          project: updated.projectName,
          action: "project_clear_files_executed",
          details: { requestId: updated.id, via: "approval" },
        });
      } else {
        await recordAudit({
          user: { id: req.user!.id },
          project: updated.projectName,
          action: "project_create_approved",
          details: {
            requestId: updated.id,
            requestedBy: updated.requestedByUsername,
          },
        });
      }
      res.json(
        assertResponseShape(
          ApproveProjectLifecycleRequestResponse,
          serializeLifecycleRequest(updated),
          "POST /projects/lifecycle-requests/:id/approve",
        ),
      );
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

async function cleanupPendingProject(projectName: string): Promise<void> {
  // Remove on-disk scaffold. Errors here are fatal so reject/cancel
  // never reports success while leaving residue behind.
  const items = await listAvailableProjects();
  const match = items.find((p) => p.solutionName === projectName);
  if (match) {
    await deleteProject(match.slnPath);
  }
  // Remove org stamp and any auto-created requester assignment so the
  // name is freed for re-creation. Both are required to succeed.
  await db
    .delete(projectOrganizationsTable)
    .where(eq(projectOrganizationsTable.projectName, projectName));
  await db
    .delete(projectAssignmentsTable)
    .where(eq(projectAssignmentsTable.projectName, projectName));
}

router.post(
  "/projects/lifecycle-requests/:id/reject",
  async (req, res): Promise<void> => {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const ok = await ensureAdminCanDecide(req, res, parsed.data.id);
    if (!ok || !ok.row) return;
    const body = DecisionBody.safeParse(req.body ?? {});
    if (!body.success) {
      respondValidationError(res, body.error);
      return;
    }
    if (ok.row.status !== "pending") {
      res.status(400).json({ error: "Request has already been decided" });
      return;
    }
    try {
      // Side effects FIRST, status flip LAST. For delete-kind there
      // are no destructive side effects on reject — the project was
      // never touched.
      if (ok.row.kind === "create") {
        await cleanupPendingProject(ok.row.projectName);
        // If the requester had this project loaded, drop it.
        setCurrentProject(null, ok.row.requestedByUserId);
      }
      const updated = await rejectLifecycleRequest({
        id: parsed.data.id,
        decidedBy: req.user!.id,
        note: body.data.note ?? null,
      });
      await recordAudit({
        user: { id: req.user!.id },
        project: updated.projectName,
        action:
          ok.row.kind === "delete"
            ? "project_delete_rejected"
            : ok.row.kind === "clear_files"
              ? "project_clear_files_rejected"
              : "project_create_rejected",
        details: {
          requestId: updated.id,
          requestedBy: updated.requestedByUsername,
          note: body.data.note ?? null,
        },
      });
      res.json(
        assertResponseShape(
          RejectProjectLifecycleRequestResponse,
          serializeLifecycleRequest(updated),
          "POST /projects/lifecycle-requests/:id/reject",
        ),
      );
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.delete(
  "/projects/lifecycle-requests/:id",
  async (req, res): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const row = await getLifecycleRequestById(parsed.data.id);
    if (!row) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (row.requestedByUserId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (row.status !== "pending") {
      res.status(400).json({ error: "Only pending requests can be cancelled" });
      return;
    }
    if (row.kind === "create") {
      await cleanupPendingProject(row.projectName);
      setCurrentProject(null, user.id);
    }
    await deleteLifecycleRequest(parsed.data.id);
    await recordAudit({
      user: { id: user.id },
      project: row.projectName,
      action:
        row.kind === "delete"
          ? "project_delete_rejected"
          : row.kind === "clear_files"
            ? "project_clear_files_rejected"
            : "project_create_rejected",
      details: { requestId: row.id, cancelled: true },
    });
    res.status(204).end();
  },
);

router.get(
  "/projects/:projectName/clear-files-preflight",
  requireRole("admin", "limited_admin"),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const rawName = req.params.projectName;
    const baseName = Array.isArray(rawName) ? rawName[0] : rawName;
    if (!baseName) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!(await enforceProjectOrgAccess(req, res, baseName))) return;
    const { bypass } = await getApprovalContext(req, user, baseName);
    const requiresApproval = !bypass;
    const pending = await getPendingClearFilesRequestForProject(baseName);
    res.json({
      requiresApproval,
      isSoleAdmin: bypass,
      hasPendingRequest: pending !== null,
    });
  },
);

router.get(
  "/projects/:projectName/delete-preflight",
  requireRole("admin", "limited_admin"),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const rawName = req.params.projectName;
    const baseName = Array.isArray(rawName) ? rawName[0] : rawName;
    if (!baseName) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!(await enforceProjectOrgAccess(req, res, baseName))) return;
    const { bypass } = await getApprovalContext(req, user, baseName);
    const requiresApproval = !bypass;
    const pending = await getPendingDeleteRequestForProject(baseName);
    res.json({
      // `isSoleAdmin` here is the legacy field name kept for back-compat
      // with the OpenAPI shape; semantically it means
      // "no other Admin is available to approve, so deletion bypasses
      // the approval flow."
      requiresApproval,
      isSoleAdmin: bypass,
      hasPendingRequest: pending !== null,
    });
  },
);

export default router;

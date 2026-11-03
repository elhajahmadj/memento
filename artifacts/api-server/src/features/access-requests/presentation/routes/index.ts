import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  approveAccessRequest,
  createAccessRequest,
  denyAccessRequest,
  getAccessRequestById,
  listAccessRequests,
  listAccessRequestsForUser,
  type AccessRequestRow,
} from "@/features/access-requests/infrastructure/accessRequestService";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import {
  enforceProjectOrgAccess,
  resolveScopePolicy,
} from "@/features/auth/infrastructure/orgScope";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

const CreateBody = z.object({ projectName: z.string().min(1).max(200) });
const StatusFilter = z.enum(["pending", "approved", "denied"]).optional();
const IdParam = z.object({ id: z.string().uuid() });
const DecisionBody = z.object({
  note: z.string().trim().max(2000).optional(),
});

function serialize(row: AccessRequestRow) {
  return {
    id: row.id,
    userId: row.userId,
    username: row.username,
    projectName: row.projectName,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decidedBy: row.decidedBy ?? null,
    note: row.note ?? null,
  };
}

// Limited admins (and limited users that the UI gates appropriately) post
// here to ask for project access. Anyone signed in may create a request.
router.post(
  "/project-access-requests",
  async (req, res): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (user.role !== "limited_admin") {
      res.status(403).json({
        error: "Only limited admins can request access to projects",
      });
      return;
    }
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    // Org scope: cross-org IDP callers cannot request access to
    // projects belonging to other orgs (404 — existence not observable).
    if (
      !(await enforceProjectOrgAccess(req, res, parsed.data.projectName))
    ) {
      return;
    }
    try {
      const created = await createAccessRequest({
        userId: user.id,
        projectName: parsed.data.projectName,
        organizationId: req.session.activeOrgId ?? null,
      });
      await recordAudit({
        user: { id: user.id },
        project: created.projectName,
        action: "access_request_create",
        details: { requestId: created.id },
      });
      res.status(201).json({
        id: created.id,
        userId: created.userId,
        username: user.username,
        projectName: created.projectName,
        status: created.status,
        requestedAt: created.requestedAt.toISOString(),
        decidedAt: null,
        decidedBy: null,
        note: null,
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.get(
  "/project-access-requests",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = StatusFilter.safeParse(req.query.status);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid status filter" });
      return;
    }
    // Org-scoped admins only see requests for projects in their active org.
    const policy = await resolveScopePolicy(req);
    if (policy.kind === "none") {
      res.json([]);
      return;
    }
    const rows = await listAccessRequests({
      status: parsed.data,
      ...(policy.kind === "org"
        ? { orgScope: { orgId: policy.orgId } }
        : {}),
    });
    res.json(rows.map(serialize));
  },
);

// "Mine": calling user's own requests, used by the limited_admin home / bell.
router.get(
  "/project-access-requests/mine",
  async (req, res): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    // Org scope: OIDC callers only see their own requests filed under
    // their active org. "none" => []. Local users keep global view.
    const policy = await resolveScopePolicy(req);
    if (policy.kind === "none") {
      res.json([]);
      return;
    }
    const rows = await listAccessRequestsForUser(
      user.id,
      policy.kind === "org" ? { orgScope: { orgId: policy.orgId } } : undefined,
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        username: user.username,
        projectName: r.projectName,
        status: r.status,
        requestedAt: r.requestedAt.toISOString(),
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
        decidedBy: r.decidedBy ?? null,
        note: r.note ?? null,
      })),
    );
  },
);

router.post(
  "/project-access-requests/:id/approve",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const body = DecisionBody.safeParse(req.body ?? {});
    if (!body.success) {
      respondValidationError(res, body.error);
      return;
    }
    // Org scope: IDP admins may only decide requests for in-org projects.
    const existing = await getAccessRequestById(parsed.data.id);
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (!(await enforceProjectOrgAccess(req, res, existing.projectName))) {
      return;
    }
    try {
      const result = await approveAccessRequest({
        id: parsed.data.id,
        decidedBy: req.user!.id,
        note: body.data.note ?? null,
      });
      await recordAudit({
        user: { id: req.user!.id },
        project: result.row.projectName,
        action: "access_request_approve",
        details: {
          requestId: result.row.id,
          requesterUsername: result.row.username,
          assignmentCreated: result.assignmentCreated,
        },
      });
      res.json(serialize(result.row));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.post(
  "/project-access-requests/:id/deny",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const body = DecisionBody.safeParse(req.body ?? {});
    if (!body.success) {
      respondValidationError(res, body.error);
      return;
    }
    const existing = await getAccessRequestById(parsed.data.id);
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (!(await enforceProjectOrgAccess(req, res, existing.projectName))) {
      return;
    }
    try {
      const updated = await denyAccessRequest({
        id: parsed.data.id,
        decidedBy: req.user!.id,
        note: body.data.note ?? null,
      });
      await recordAudit({
        user: { id: req.user!.id },
        project: updated.projectName,
        action: "access_request_deny",
        details: {
          requestId: updated.id,
          requesterUsername: updated.username,
          note: body.data.note ?? null,
        },
      });
      res.json(serialize(updated));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

// Allow admins to fetch a single request — useful for the access-request
// detail panel.
router.get(
  "/project-access-requests/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const row = await getAccessRequestById(parsed.data.id);
    if (!row) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    // Cross-org IDP admins should not see requests targeting other orgs.
    if (!(await enforceProjectOrgAccess(req, res, row.projectName))) {
      return;
    }
    res.json(serialize(row));
  },
);

export default router;

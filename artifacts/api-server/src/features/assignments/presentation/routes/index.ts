import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import {
  createAssignment,
  listAssignments,
  removeAssignment,
  listItemsLosingReviewer,
} from "@/features/assignments/infrastructure/assignmentService";
import { clearCurrentProjectIfSolution } from "@/features/projects/infrastructure/projectService";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import {
  enforceProjectOrgAccess,
  resolveScopePolicy,
} from "@/features/auth/infrastructure/orgScope";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

const CreateBody = z.object({
  userId: z.string().uuid(),
  projectName: z.string().min(1).max(200),
});
const RemoveParams = z.object({
  userId: z.string().uuid(),
  projectName: z.string().min(1).max(200),
});

function serialize(row: Awaited<ReturnType<typeof listAssignments>>[number]) {
  return {
    id: row.id,
    userId: row.userId,
    username: row.username,
    projectName: row.projectName,
    assignedBy: row.assignedBy,
    assignedAt: row.assignedAt.toISOString(),
  };
}

router.get(
  "/project-assignments",
  requireAdmin,
  async (req, res): Promise<void> => {
    // Org-scoped admins (IDP) only see assignments for projects in
    // their active org. Local admins see everything.
    const policy = await resolveScopePolicy(req);
    const rows =
      policy.kind === "org"
        ? await listAssignments({ orgScope: { orgId: policy.orgId } })
        : policy.kind === "none"
          ? []
          : await listAssignments();
    res.json(rows.map(serialize));
  },
);

router.post(
  "/project-assignments",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    // Org scope: IDP admins can only assign within their org; cross-org
    // returns 404 (existence not observable).
    if (
      !(await enforceProjectOrgAccess(req, res, parsed.data.projectName))
    ) {
      return;
    }
    try {
      const created = await createAssignment({
        userId: parsed.data.userId,
        projectName: parsed.data.projectName,
        assignedBy: req.user!.id,
        organizationId: req.session.activeOrgId ?? null,
      });
      await recordAudit({
        user: { id: req.user!.id },
        project: created.projectName,
        action: "project_assignment_create",
        details: {
          assignmentId: created.id,
          assignedUserId: created.userId,
          assignedUsername: created.username,
        },
      });
      res.status(201).json(serialize(created));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.delete(
  "/project-assignments/:userId/:projectName",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = RemoveParams.safeParse({
      userId: req.params.userId,
      projectName: req.params.projectName,
    });
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    // Org scope: IDP admins can only act on assignments in their org.
    if (
      !(await enforceProjectOrgAccess(req, res, parsed.data.projectName))
    ) {
      return;
    }
    try {
      const items = await listItemsLosingReviewer({
        projectName: parsed.data.projectName,
      });
      const result = await removeAssignment({
        userId: parsed.data.userId,
        projectName: parsed.data.projectName,
      });
      if (!result.removed) {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }
      // Record the unassign itself, including which open items the
      // unassigned reviewer is no longer able to action so they can
      // be picked up by the remaining reviewer pool.
      await recordAudit({
        user: { id: req.user!.id },
        project: parsed.data.projectName,
        action: "project_assignment_remove",
        details: {
          unassignedUserId: parsed.data.userId,
          unassignedUsername: result.username,
          reassignedPendingForkIds: items.pendingForkIds,
          reassignedPendingApprovalIds: items.pendingApprovalIds,
          reassignedFromUserId: parsed.data.userId,
          reassignedFromUsername: result.username,
        },
      });
      // Per-item audit entries make the reassignment explicit so each
      // pending fork / approval shows up in its own audit history.
      for (const forkId of items.pendingForkIds) {
        await recordAudit({
          user: { id: req.user!.id },
          project: parsed.data.projectName,
          action: "project_assignment_remove",
          details: {
            kind: "pending_fork_reassigned",
            forkId,
            fromUserId: parsed.data.userId,
            fromUsername: result.username,
          },
        });
      }
      for (const approvalId of items.pendingApprovalIds) {
        await recordAudit({
          user: { id: req.user!.id },
          project: parsed.data.projectName,
          action: "project_assignment_remove",
          details: {
            kind: "pending_approval_reassigned",
            approvalId,
            fromUserId: parsed.data.userId,
            fromUsername: result.username,
          },
        });
      }
      // Drop the unassigned user's cached current project if it matches
      // the project they just lost, so their next request can't keep
      // reading/editing the project through the loaded-project context.
      clearCurrentProjectIfSolution(parsed.data.userId, parsed.data.projectName);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

export default router;

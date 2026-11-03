import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAnyAdmin } from "@/shared/middlewares/requireRole";
import { getEffectiveRole } from "@/shared/middlewares/effectiveRole";
import { type User } from "@workspace/db";
import {
  getAssignedProjectNames,
  isAdminOrAssigned,
} from "@/features/assignments/infrastructure/assignmentService";
import {
  computeChangedFilesWithConflictCount,
  computeFileDiff,
  diffBaseDirForApproval,
  mainDirForApproval,
  type ApprovalRow,
} from "@/features/approvals/infrastructure/approvalService";
import { getContainer } from "@/composition/container";
import { unwrap } from "@workspace/kernel";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import {
  enforceProjectOrgAccess,
  resolveScopePolicy,
} from "@/features/auth/infrastructure/orgScope";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

const StatusFilter = z.enum(["pending", "approved", "rejected"]).optional();
const IdParam = z.object({ id: z.string().uuid() });
const DecisionBody = z.object({
  comment: z.string().trim().max(2000).optional(),
});

const ApproveBody = z.object({
  comment: z.string().trim().max(2000).optional(),
  selectedFiles: z.array(z.string()).max(10000).optional(),
  acknowledgeConflicts: z.boolean().optional(),
});

function serialize(row: ApprovalRow) {
  return {
    id: row.id,
    forkId: row.forkId,
    submittedBy: row.submittedBy,
    submittedAt: row.submittedAt.toISOString(),
    status: row.status,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decidedBy: row.decidedBy ?? null,
    comment: row.comment ?? null,
    submitterComment: row.submitterComment ?? null,
    snapshotPath: row.snapshotPath,
    username: row.username,
    projectName: row.projectName,
    forkPath: row.forkPath,
  };
}

// "My approvals" — every submission the calling user has ever sent. Used by
// the limited home to render per-project pending / approved / rejected
// status. Authenticated, no admin requirement.
router.get("/approvals/mine", async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = unwrap(await getContainer().useCases.approvals.listApprovalsForUser.execute(user.id));
  res.json(rows.map(serialize));
});

router.get("/approvals", requireAnyAdmin, async (req, res): Promise<void> => {
  const parsed = StatusFilter.safeParse(req.query.status);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status filter" });
    return;
  }
  let rows = unwrap(await getContainer().useCases.approvals.listApprovals.execute({ status: parsed.data }));
  // Limited admins only see submissions for projects they're assigned to.
  // Authorize on the *effective* (per-org) role — task #36.
  const callerEffective = (await getEffectiveRole(req)) ?? req.user!.role;
  if (callerEffective === "limited_admin") {
    const assigned = new Set(await getAssignedProjectNames(req.user!.id));
    rows = rows.filter((r) => assigned.has(r.projectName));
  }
  // Org scope: OIDC admins only see submissions for projects in their
  // active org. Local admins keep the global view unchanged. "none"
  // (OIDC user without active org) returns []. We filter via
  // enforceProjectOrgAccess semantics by reusing canSeeProject.
  const policy = await resolveScopePolicy(req);
  if (policy.kind === "none") {
    res.json([]);
    return;
  }
  if (policy.kind === "org") {
    const { filterVisibleProjectNames } = await import(
      "@/features/auth/infrastructure/orgScope"
    );
    const visible = await filterVisibleProjectNames(
      policy,
      rows.map((r) => r.projectName),
    );
    rows = rows.filter((r) => visible.has(r.projectName));
  }
  // Decorate with a quick changed-files count so the queue can show a summary.
  const out = await Promise.all(
    rows.map(async (r) => {
      let changedFiles = 0;
      let conflictCount = 0;
      try {
        const result = await computeChangedFilesWithConflictCount({
          snapshotDir: r.snapshotPath,
          mainDir: mainDirForApproval(r),
        });
        changedFiles = result.files.length;
        conflictCount = result.conflictCount;
      } catch {
        changedFiles = 0;
        conflictCount = 0;
      }
      return { ...serialize(r), changedFiles, conflictCount };
    }),
  );
  res.json(out);
});

// Owners may read their own submission detail and diff so the limited
// "My submissions" page can render full review history. Admins may read
// any submission. Decisions (approve/reject) stay admin-only.
async function canReadOwnOrAdmin(
  req: import("express").Request,
  user: User | undefined,
  row: { submittedBy: string; projectName: string },
): Promise<boolean> {
  if (!user) return false;
  // Authorize on the *effective* (per-org) role — task #36.
  const effective = (await getEffectiveRole(req)) ?? user.role;
  if (effective === "admin" || effective === "memento_admin") return true;
  if (effective === "limited_admin") {
    return isAdminOrAssigned({ id: user.id, role: effective }, row.projectName);
  }
  return user.id === row.submittedBy;
}

async function ensureCanDecideApproval(
  req: import("express").Request,
  res: import("express").Response,
  approvalId: string,
): Promise<boolean> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  // Org scope first — cross-org OIDC users get a 404 (existence hidden)
  // before any role check.
  const row = await (async () => { const r = await getContainer().useCases.approvals.getApprovalById.execute(approvalId); return r.kind === "ok" ? r.value : null; })();
  if (!row) {
    res.status(404).json({ error: "Submission not found" });
    return false;
  }
  if (!(await enforceProjectOrgAccess(req, res, row.projectName))) {
    return false;
  }
  // Authorize on the *effective* (per-org) role — task #36.
  const effective = (await getEffectiveRole(req)) ?? user.role;
  if (effective === "admin" || effective === "memento_admin") return true;
  if (effective !== "limited_admin") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  if (
    await isAdminOrAssigned(
      { id: user.id, role: effective },
      row.projectName,
    )
  ) {
    return true;
  }
  res
    .status(403)
    .json({ error: "Forbidden: not assigned to this project" });
  return false;
}

router.get("/approvals/:id", async (req, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = IdParam.safeParse(req.params);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  const row = await (async () => { const r = await getContainer().useCases.approvals.getApprovalById.execute(parsed.data.id); return r.kind === "ok" ? r.value : null; })();
  if (!row) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  // Cross-org OIDC viewer should not be able to confirm existence.
  if (!(await enforceProjectOrgAccess(req, res, row.projectName))) {
    return;
  }
  if (!(await canReadOwnOrAdmin(req, req.user, row))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(serialize(row));
});

router.get(
  "/approvals/:id/diff",
  async (req, res): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const row = await (async () => { const r = await getContainer().useCases.approvals.getApprovalById.execute(parsed.data.id); return r.kind === "ok" ? r.value : null; })();
    if (!row) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    if (!(await enforceProjectOrgAccess(req, res, row.projectName))) {
      return;
    }
    if (!(await canReadOwnOrAdmin(req, req.user, row))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const fileParam =
      typeof req.query.file === "string" ? req.query.file : undefined;
    // For pending submissions this is current main; for decided
    // submissions it's the persisted historical copy of main from submit
    // time so the diff still reflects what the SDET reviewed.
    const mainDir = await diffBaseDirForApproval(row);
    if (fileParam) {
      // Defense against path traversal: only honor file paths that the
      // diff machinery itself reports as part of this submission. This
      // prevents a caller (now including the submission's owner) from
      // requesting arbitrary paths like "../../etc/passwd".
      const allowed = await computeChangedFilesWithConflictCount({
        snapshotDir: row.snapshotPath,
        mainDir,
      });
      const isAllowed = allowed.files.some((f) => f.path === fileParam);
      if (!isAllowed) {
        res.status(404).json({ error: "File not found in diff" });
        return;
      }
      const detail = await computeFileDiff({
        snapshotDir: row.snapshotPath,
        mainDir,
        relPath: fileParam,
      });
      if (!detail) {
        res.status(404).json({ error: "File not found in diff" });
        return;
      }
      res.json(detail);
      return;
    }
    const result = await computeChangedFilesWithConflictCount({
      snapshotDir: row.snapshotPath,
      mainDir,
    });
    res.json({
      files: result.files,
      conflictCount: result.conflictCount,
    });
  },
);

router.post(
  "/approvals/:id/approve",
  async (req, res): Promise<void> => {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    if (!(await ensureCanDecideApproval(req, res, parsed.data.id))) return;
    const body = ApproveBody.safeParse(req.body ?? {});
    if (!body.success) {
      respondValidationError(res, body.error);
      return;
    }
    const approveResult = await getContainer().useCases.approvals.approveSubmission.execute({
      id: parsed.data.id,
      decidedBy: req.user!.id,
      comment: body.data.comment ?? null,
      selectedFiles: body.data.selectedFiles,
      acknowledgeConflicts: body.data.acknowledgeConflicts,
    });
    if (approveResult.kind === "err") {
      res.status(400).json({ error: approveResult.error.message });
      return;
    }
    const result = approveResult.value;
    try {
      await recordAudit({
        user: { id: req.user!.id },
        project: result.row.projectName,
        action: "approval_approve",
        details: {
          submissionId: result.row.id,
          forkId: result.row.forkId,
          submittedBy: result.row.username,
          filesWritten: result.applied.written,
          filesDeleted: result.applied.deleted,
          selectedFiles: result.applied.selectedFiles,
          conflictCount: result.applied.conflictCount,
          acknowledgedConflicts: body.data.acknowledgeConflicts ?? false,
        },
      });
      res.json(serialize(result.row));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.post(
  "/approvals/:id/reject",
  async (req, res): Promise<void> => {
    const parsed = IdParam.safeParse(req.params);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    if (!(await ensureCanDecideApproval(req, res, parsed.data.id))) return;
    const body = DecisionBody.safeParse(req.body ?? {});
    if (!body.success) {
      respondValidationError(res, body.error);
      return;
    }
    const rejectResult = await getContainer().useCases.approvals.rejectSubmission.execute({
      id: parsed.data.id,
      decidedBy: req.user!.id,
      comment: body.data.comment ?? null,
    });
    if (rejectResult.kind === "err") {
      res.status(400).json({ error: rejectResult.error.message });
      return;
    }
    const updated = rejectResult.value;
    try {
      await recordAudit({
        user: { id: req.user!.id },
        project: updated.projectName,
        action: "approval_reject",
        details: {
          submissionId: updated.id,
          forkId: updated.forkId,
          submittedBy: updated.username,
          comment: body.data.comment ?? null,
        },
      });
      res.json(serialize(updated));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

export default router;

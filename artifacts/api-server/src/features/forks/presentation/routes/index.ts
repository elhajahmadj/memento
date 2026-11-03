import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  approveFork,
  createFork,
  deleteFork,
  denyFork,
  listAllForks,
  listAvailableProjectsForUser,
  listForksForUser,
  requestFork,
  getForkById,
} from "@/features/forks/infrastructure/forkService";
import { createSubmissionFromFork } from "@/features/approvals/infrastructure/approvalService";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import { getEffectiveRole } from "@/shared/middlewares/effectiveRole";
import {
  getAssignedProjectNames,
  isAdminOrAssigned,
} from "@/features/assignments/infrastructure/assignmentService";
import {
  enforceProjectOrgAccess,
  filterVisibleProjectNames,
  resolveScopePolicy,
} from "@/features/auth/infrastructure/orgScope";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

const CreateForkBody = z.object({
  userId: z.string().uuid(),
  projectName: z.string().min(1),
});
const RequestForkBody = z.object({
  projectName: z.string().min(1),
});
const ForkIdParam = z.object({ id: z.string().uuid() });
const SubmitForkBody = z.object({
  comment: z.string().trim().max(2000).optional(),
});

function serialize(row: Awaited<ReturnType<typeof listAllForks>>[number]) {
  return {
    id: row.id,
    userId: row.userId,
    username: row.username,
    projectName: row.projectName,
    forkPath: row.forkPath,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decidedBy: row.decidedBy ?? null,
  };
}

router.get("/forks", async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Authorize on the *effective* (per-org) role — task #36.
  const effective = (await getEffectiveRole(req)) ?? user.role;
  let rows;
  if (effective === "admin" || effective === "memento_admin") {
    rows = await listAllForks();
  } else if (effective === "limited_admin") {
    // Limited admins see fork requests only for projects they're assigned
    // to. They don't have personal forks themselves.
    const assigned = new Set(await getAssignedProjectNames(user.id));
    const all = await listAllForks();
    rows = all.filter((r) => assigned.has(r.projectName));
  } else {
    rows = await listForksForUser(user.id);
  }
  // Org scope: bound OIDC callers to their active org's projects.
  const policy = await resolveScopePolicy(req);
  if (policy.kind === "none") {
    res.json([]);
    return;
  }
  if (policy.kind === "org") {
    const visible = await filterVisibleProjectNames(
      policy,
      rows.map((r) => r.projectName),
    );
    rows = rows.filter((r) => visible.has(r.projectName));
  }
  res.json(rows.map(serialize));
});

router.get("/forks/available-projects", async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Org scope: an OIDC limited user must only see projects from their
  // active org. "none" => empty list. Local users keep the global view.
  const policy = await resolveScopePolicy(req);
  if (policy.kind === "none") {
    res.json([]);
    return;
  }
  let visible: Set<string> | null = null;
  if (policy.kind === "org") {
    // Pre-resolve every workspace project's visibility for this org so
    // the service can filter without re-querying per-project.
    const { listAvailableProjects } = await import(
      "@/features/projects/infrastructure/projectService"
    );
    const all = await listAvailableProjects();
    visible = await filterVisibleProjectNames(
      policy,
      all.map((p) => p.solutionName),
    );
  }
  const rows = await listAvailableProjectsForUser({
    user,
    visibleProjectNames: visible,
  });
  res.json(rows);
});

router.post("/forks", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateForkBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  if (!(await enforceProjectOrgAccess(req, res, parsed.data.projectName))) {
    return;
  }
  try {
    const created = await createFork({
      userId: parsed.data.userId,
      projectName: parsed.data.projectName,
      decidedBy: req.user!.id,
    });
    res.status(201).json(serialize(created));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/forks/request", async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = RequestForkBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  if (!(await enforceProjectOrgAccess(req, res, parsed.data.projectName))) {
    return;
  }
  try {
    const created = await requestFork({
      userId: user.id,
      projectName: parsed.data.projectName,
    });
    res.status(201).json(serialize(created));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

async function ensureCanActOnFork(
  req: import("express").Request,
  res: import("express").Response,
  forkId: string,
): Promise<boolean> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  // Org scope first — cross-org OIDC users see a 404 before any role
  // check, hiding existence of out-of-org forks.
  const fork = await getForkById(forkId);
  if (!fork) {
    res.status(404).json({ error: "Fork not found" });
    return false;
  }
  if (!(await enforceProjectOrgAccess(req, res, fork.projectName))) {
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
      fork.projectName,
    )
  ) {
    return true;
  }
  res
    .status(403)
    .json({ error: "Forbidden: not assigned to this project" });
  return false;
}

router.post(
  "/forks/:id/approve",
  async (req, res): Promise<void> => {
    const parsed = ForkIdParam.safeParse(req.params);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    if (!(await ensureCanActOnFork(req, res, parsed.data.id))) return;
    try {
      const updated = await approveFork({
        forkId: parsed.data.id,
        decidedBy: req.user!.id,
      });
      res.json(serialize(updated));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.post(
  "/forks/:id/deny",
  async (req, res): Promise<void> => {
    const parsed = ForkIdParam.safeParse(req.params);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    if (!(await ensureCanActOnFork(req, res, parsed.data.id))) return;
    try {
      await denyFork({ forkId: parsed.data.id, decidedBy: req.user!.id });
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.delete(
  "/forks/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = ForkIdParam.safeParse(req.params);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    // Org guard before destructive action: an OIDC admin from a
    // different org must not delete this fork. 404 hides existence.
    const fork = await getForkById(parsed.data.id);
    if (!fork) {
      res.status(404).json({ error: "Fork not found" });
      return;
    }
    if (!(await enforceProjectOrgAccess(req, res, fork.projectName))) {
      return;
    }
    try {
      await deleteFork(parsed.data.id);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.post("/forks/:id/submit", async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = ForkIdParam.safeParse(req.params);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  const fork = await getForkById(parsed.data.id);
  if (!fork) {
    res.status(404).json({ error: "Fork not found" });
    return;
  }
  if (!(await enforceProjectOrgAccess(req, res, fork.projectName))) {
    return;
  }
  // Authorize on the *effective* (per-org) role — task #36.
  const effective = (await getEffectiveRole(req)) ?? user.role;
  if (effective === "admin" || effective === "memento_admin") {
    // ok
  } else if (effective === "limited_admin") {
    if (
      !(await isAdminOrAssigned(
        { id: user.id, role: effective },
        fork.projectName,
      ))
    ) {
      res
        .status(403)
        .json({ error: "Forbidden: not assigned to this project" });
      return;
    }
  } else if (fork.userId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = SubmitForkBody.safeParse(req.body ?? {});
  if (!body.success) {
    respondValidationError(res, body.error);
    return;
  }
  const submitterComment = body.data.comment ? body.data.comment : null;
  try {
    const submission = await createSubmissionFromFork({
      fork,
      submittedBy: user.id,
      submitterComment,
    });
    await recordAudit({
      user: { id: user.id },
      project: fork.projectName,
      action: "approval_submit",
      details: {
        submissionId: submission.id,
        forkId: fork.id,
        hasComment: submitterComment !== null,
      },
    });
    res.status(201).json({
      id: submission.id,
      forkId: submission.forkId,
      submittedBy: submission.submittedBy,
      submittedAt: submission.submittedAt.toISOString(),
      status: submission.status,
      decidedAt: submission.decidedAt
        ? submission.decidedAt.toISOString()
        : null,
      decidedBy: submission.decidedBy ?? null,
      comment: submission.comment ?? null,
      submitterComment: submission.submitterComment ?? null,
      snapshotPath: submission.snapshotPath,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Convenience: a Limited user can ask "do I have a fork for project X?".
router.get("/forks/by-project/:projectName", async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const projectName = String(req.params.projectName ?? "");
  // Org guard: hide existence of cross-org projects from OIDC callers.
  if (!(await enforceProjectOrgAccess(req, res, projectName))) {
    return;
  }
  const all = await listForksForUser(user.id);
  const match = all.find((f) => f.projectName === projectName);
  if (!match) {
    res.json({ fork: null });
    return;
  }
  // Authorize on the *effective* (per-org) role — task #36.
  const effective = (await getEffectiveRole(req)) ?? user.role;
  if (
    effective !== "admin" &&
    effective !== "limited_admin" &&
    effective !== "memento_admin" &&
    match.userId !== user.id
  ) {
    // (defensive) shouldn't happen — listForksForUser already restricts.
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // Re-fetch with username via getForkById to keep shape consistent.
  const row = await getForkById(match.id);
  res.json({ fork: row ? serialize(row) : null });
});

export default router;

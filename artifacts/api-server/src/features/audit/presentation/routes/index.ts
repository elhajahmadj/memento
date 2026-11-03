import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  auditEventsTable,
  usersTable,
  type AuditAction,
} from "@workspace/db";
import { requireAnyAdmin } from "@/shared/middlewares/requireRole";
import { getEffectiveRole } from "@/shared/middlewares/effectiveRole";
import { getAssignedProjectNames } from "@/features/assignments/infrastructure/assignmentService";
import { inArray } from "drizzle-orm";

const router: IRouter = Router();

const PAGE_SIZE = 50;

const VALID_ACTIONS = new Set<AuditAction>([
  "file_create",
  "file_save",
  "file_delete",
  "file_rename",
  "folder_create",
  "recording_finalize",
  "approval_submit",
  "approval_approve",
  "approval_reject",
  "fork_create",
  "fork_delete",
  "role_change",
  "project_assignment_create",
  "project_assignment_remove",
  "access_request_create",
  "access_request_approve",
  "access_request_deny",
  "validation_queued",
  "validation_completed",
  "validation_failed",
  "internal_test_run_start",
  "internal_test_run_complete",
  "recorded_action_edit",
  "user_delete",
  "project_git_pull",
  "project_git_push",
  "project_git_branch_create",
  "project_git_branch_checkout",
]);

function isAuditAction(value: string): value is AuditAction {
  return VALID_ACTIONS.has(value as AuditAction);
}

router.get("/audit", requireAnyAdmin, async (req, res): Promise<void> => {
  const userParam = typeof req.query.user === "string" ? req.query.user.trim() : "";
  const projectParam =
    typeof req.query.project === "string" ? req.query.project.trim() : "";
  const actionParam =
    typeof req.query.action === "string" ? req.query.action.trim() : "";
  const pageParam = typeof req.query.page === "string" ? Number(req.query.page) : 1;
  const page =
    Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;

  const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof inArray>> = [];
  // Limited admins see only events whose project column matches one of
  // their assigned projects. Events with NULL project (global/system
  // events) are intentionally NOT shown to limited admins.
  // Authorize on the *effective* (per-org) role — task #36. SSO admins
  // carry `users.role = 'limited'` globally; only the resolver tells us
  // whether the caller is a *limited_admin* (project-filtered view) or
  // a full admin (workspace-wide view) in the active org.
  const effective = (await getEffectiveRole(req)) ?? req.user!.role;
  if (effective === "limited_admin") {
    const assigned = await getAssignedProjectNames(req.user!.id);
    if (assigned.length === 0) {
      res.json({ events: [], page: 1, pageSize: PAGE_SIZE, total: 0 });
      return;
    }
    conditions.push(inArray(auditEventsTable.project, assigned));
  }
  if (userParam) {
    // Accept either a UUID (user_id) or a username for convenience.
    if (/^[0-9a-f-]{36}$/i.test(userParam)) {
      conditions.push(eq(auditEventsTable.userId, userParam));
    } else {
      const [u] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, userParam))
        .limit(1);
      if (!u) {
        res.json({ events: [], page, pageSize: PAGE_SIZE, total: 0 });
        return;
      }
      conditions.push(eq(auditEventsTable.userId, u.id));
    }
  }
  if (projectParam) {
    conditions.push(eq(auditEventsTable.project, projectParam));
  }
  if (actionParam) {
    if (!isAuditAction(actionParam)) {
      res.status(400).json({ error: `Unknown action '${actionParam}'` });
      return;
    }
    conditions.push(eq(auditEventsTable.action, actionParam));
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(auditEventsTable)
    .where(whereClause);

  const rows = await db
    .select({
      id: auditEventsTable.id,
      createdAt: auditEventsTable.createdAt,
      action: auditEventsTable.action,
      project: auditEventsTable.project,
      filePath: auditEventsTable.filePath,
      details: auditEventsTable.details,
      userId: auditEventsTable.userId,
      username: usersTable.username,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(auditEventsTable)
    .leftJoin(usersTable, eq(usersTable.id, auditEventsTable.userId))
    .where(whereClause)
    .orderBy(desc(auditEventsTable.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  res.json({
    events: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      action: r.action,
      project: r.project,
      filePath: r.filePath,
      details: r.details,
      userId: r.userId,
      username: r.username,
      firstName: r.firstName,
      lastName: r.lastName,
    })),
    page,
    pageSize: PAGE_SIZE,
    total: count,
  });
});

export default router;

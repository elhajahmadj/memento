import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, auditEventsTable, usersTable } from "@workspace/db";
import {
  getCurrentSessionInfoForUser,
} from "@/features/recording/infrastructure/recordingService";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import {
  requireAdminOrAssignedToCurrentProjectOrOwnerAllowNoProject,
  requireAnyAdmin,
} from "@/shared/middlewares/requireRole";
import { clearHookBackups } from "@/features/codegen/infrastructure/codegen";

export function historyRoutes(): IRouter {
  const router = Router();

  /**
   * Per-recording History panel data source. Returns every
   * `recorded_action_edit` audit row written for the **caller's** active
   * session, joined with the actor's name + username. Newest-first.
   *
   * Audit visibility for `recorded_action_edit` already mirrors the
   * standard /audit endpoint (admin / limited_admin only) — limited
   * admins additionally have to be the session owner since
   * `getCurrentSessionInfoForUser` refuses to return another user's
   * token. Without an active session the response is just an empty
   * `events` array (the panel is also conditionally rendered client-side).
   *
   * Filtering on `details->>'sessionToken'` is safe because the column
   * is JSONB and every recorded edit since this commit stamps the token
   * via `auditRecordedActionEdit`. Older rows (if any) won't match.
   */
  router.get(
    "/recording/edit-history",
    requireAnyAdmin,
    async (req, res): Promise<void> => {
      if (!req.user?.id) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const info = getCurrentSessionInfoForUser(req.user.id);
      if (!info) {
        res.json({ events: [], sessionToken: null });
        return;
      }
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
        .where(
          and(
            eq(auditEventsTable.action, "recorded_action_edit"),
            sql`${auditEventsTable.details} ->> 'sessionToken' = ${info.sessionToken}`,
          ),
        )
        .orderBy(desc(auditEventsTable.createdAt))
        .limit(200);

      res.json({
        sessionToken: info.sessionToken,
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
      });
    },
  );

  router.post(
    "/recording/clear-hook-backups",
    requireAdminOrAssignedToCurrentProjectOrOwnerAllowNoProject,
    async (req, res): Promise<void> => {
      const project = getCurrentProject(req.user?.id);
      if (!project) {
        res.status(400).json({ error: "No active project" });
        return;
      }
      try {
        const result = await clearHookBackups(project);
        res.json(result);
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    },
  );

  return router;
}

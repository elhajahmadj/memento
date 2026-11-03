import { Router, type IRouter } from "express";
import {
  stopBrowser,
  discardSession,
  forceDiscardSession,
  SessionOwnershipError,
} from "@/features/recording/infrastructure/recordingService";
import {
  requireAdminOrAssignedToCurrentProjectOrOwnerAllowNoProject,
  requireAnyAdmin,
} from "@/shared/middlewares/requireRole";

export function stopRoutes(): IRouter {
  const router = Router();

  router.post(
    "/recording/stop",
    requireAdminOrAssignedToCurrentProjectOrOwnerAllowNoProject,
    async (req, res): Promise<void> => {
      // Stop the browser only — the session stays alive in the `stopped`
      // phase so the user can review captured actions and add UI assertions
      // before picking Save (admin) or Request SDET approval (limited),
      // which goes through `/recording/finalize`.
      if (!req.user?.id) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      try {
        // H-8: scoped to the caller. The singleton session means "a
        // session exists" says nothing about whose it is, and this route
        // previously stopped whichever one was running.
        const status = await stopBrowser(req.user.id);
        res.json(status);
      } catch (e) {
        if (e instanceof SessionOwnershipError) {
          res.status(403).json({ status: "error", message: e.message });
          return;
        }
        res
          .status(400)
          .json({ status: "error", message: (e as Error).message });
      }
    },
  );

  router.post(
    "/recording/discard",
    requireAdminOrAssignedToCurrentProjectOrOwnerAllowNoProject,
    async (req, res): Promise<void> => {
      if (!req.user?.id) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      try {
        // Throw away the in-memory session belonging to this user without
        // saving anything to disk. Cancels any session-scoped validation
        // runs still queued/running so we don't leave dangling DB rows
        // pointing at a recording that never made it to a file. Idempotent:
        // returns discarded=false when the user had no active session.
        const discarded = await discardSession(req.user.id);
        res.json({ discarded });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    },
  );

  /**
   * Admin escape hatch for the global recording session.
   *
   * The recorder service stores a single in-memory session shared across
   * all users. The per-user `/recording/discard` route deliberately
   * refuses to clear another user's session — but that means a session
   * left dangling by user A (e.g. their browser tab crashed before they
   * could discard) blocks every subsequent `POST /recording/start` from
   * user B with "Recording already in progress" until the api-server
   * restarts. This route lets any admin (or limited admin) clear the
   * current session regardless of who owns it so concurrent users can
   * recover without an operator restart. Recorded audit row mentions the
   * displaced owner + project so the action is traceable.
   *
   * Returns the same `{ discarded }` shape as `/recording/discard` plus
   * the displaced session's previous owner / project for surfacing in
   * the UI when wired up.
   */
  router.post(
    "/recording/force-discard",
    requireAnyAdmin,
    async (req, res): Promise<void> => {
      if (!req.user?.id) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      try {
        const result = await forceDiscardSession();
        if (result.discarded) {
          // Trace-level visibility into who got displaced. Recording-session
          // audit_events are reserved for finalize/recorded-edit, so we
          // surface the displacement on the request logger instead of
          // adding a new pg enum value just for this admin recovery path.
          req.log.warn(
            {
              forcedBy: req.user.id,
              previousOwnerUserId: result.ownerUserId,
              previousProjectName: result.projectName,
              wasSelf: result.ownerUserId === req.user.id,
            },
            "Admin force-discarded a recording session owned by another user",
          );
        }
        res.json({
          discarded: result.discarded,
          previousOwnerUserId: result.ownerUserId,
          previousProjectName: result.projectName,
        });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    },
  );

  return router;
}

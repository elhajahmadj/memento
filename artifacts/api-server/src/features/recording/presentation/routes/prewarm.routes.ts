import { Router, type IRouter } from "express";
import { PrewarmRecordingBrowserResponse } from "@workspace/api-zod";
import { assertResponseShape } from "@/shared/assertResponseShape";
import { prewarmBrowser } from "@/features/recording/infrastructure/recordingService";

/**
 * Speculative browser pre-warm (latency optimization).
 *
 * The frontend calls this the moment a user opens the New Project dialog
 * or clicks Open on an existing project — i.e. before they reach the
 * workbench. Launching headless Chromium is the slow step before a
 * recording can begin, so we start it in the background now and
 * `start()` / `openBrowser()` consume the warm instance when the user
 * actually records. If they never do, the pool's idle timer closes it.
 *
 * Fire-and-forget by design: the launch happens off the request path, so
 * the handler returns immediately. No project context is required (there
 * may not be one yet). Global `requireAuth` already gates `/api/*`.
 */
export function prewarmRoutes(): IRouter {
  const router = Router();

  router.post("/recording/prewarm", (req, res): void => {
    const userId = req.user?.id;
    if (!userId) {
      // Defensive only — global `requireAuth` already gates `/api/*`, so
      // this should be unreachable. Return a plain error (not a body that
      // mimics the success schema) to make that explicit and avoid schema
      // drift, matching the 401 shape used by the sibling recording routes.
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    prewarmBrowser(userId);
    res.json(
      assertResponseShape(
        PrewarmRecordingBrowserResponse,
        { prewarming: true },
        "POST /recording/prewarm",
      ),
    );
  });

  return router;
}

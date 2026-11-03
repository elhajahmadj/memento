import { Router, type IRouter } from "express";
import {
  getHookState,
  checkMethodNameCollision,
  getReplayableHooks,
  readNamedUrls,
} from "@/features/recording/infrastructure/recordingService";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import {
  requireAdminOrAssignedToCurrentProjectOrOwner,
  requireAdminOrAssignedToCurrentProjectOrOwnerAllowNoProject,
} from "@/shared/middlewares/requireRole";

export function infoRoutes(): IRouter {
  const router = Router();

  router.get(
    "/recording/hook-state",
    requireAdminOrAssignedToCurrentProjectOrOwner,
    async (req, res): Promise<void> => {
      const filePath = String(req.query.filePath ?? "");
      const hook = String(req.query.hook ?? "");
      if (!filePath || (hook !== "beforeEach" && hook !== "oneTimeSetup")) {
        res.status(400).json({ error: "filePath and hook are required" });
        return;
      }
      try {
        const result = await getHookState(
          filePath,
          hook as "beforeEach" | "oneTimeSetup",
          getCurrentProject(req.user?.id),
        );
        res.json(result);
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    },
  );

  router.get(
    "/recording/replayable-hooks",
    requireAdminOrAssignedToCurrentProjectOrOwner,
    async (req, res): Promise<void> => {
      const filePath = String(req.query.filePath ?? "");
      if (!filePath) {
        res.status(400).json({ error: "filePath is required" });
        return;
      }
      if (!req.user?.id) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      try {
        const result = await getReplayableHooks(
          filePath,
          req.user.id,
          getCurrentProject(req.user.id),
        );
        res.json(result);
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    },
  );

  /**
   * List the named start URLs the current project already has on disk
   * (C#: `appsettings.json` → `Urls`; .env-backed langs: `<SOL>_URL_*`
   * keys in the project root `.env`). Drives the "Start recording"
   * dialog: when this returns non-empty the dialog offers a dropdown of
   * existing names so the user can re-use a previously-set base URL
   * instead of retyping it. Returns `{ urls: [] }` for brand-new
   * projects with no recorded URLs yet, which makes the dialog fall
   * back to its original free-text URL/name inputs.
   *
   * Returns 404 when no project is currently loaded — the same
   * convention the rest of the project-scoped recording reads use.
   */
  router.get(
    "/recording/named-urls",
    requireAdminOrAssignedToCurrentProjectOrOwnerAllowNoProject,
    async (req, res): Promise<void> => {
      const project = getCurrentProject(req.user?.id);
      if (!project) {
        res.status(404).json({ error: "No current project" });
        return;
      }
      try {
        const urls = await readNamedUrls(project);
        res.json({ urls });
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    },
  );

  router.get(
    "/recording/method-state",
    requireAdminOrAssignedToCurrentProjectOrOwner,
    async (req, res): Promise<void> => {
      const filePath = String(req.query.filePath ?? "");
      const methodName = String(req.query.methodName ?? "");
      if (!filePath || !methodName) {
        res.status(400).json({ error: "filePath and methodName are required" });
        return;
      }
      try {
        const result = await checkMethodNameCollision(
          filePath,
          methodName,
          getCurrentProject(req.user?.id),
        );
        res.json(result);
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    },
  );

  return router;
}

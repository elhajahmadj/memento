import { Router, type IRouter } from "express";
import {
  OpenRecordingBrowserBody,
  OpenRecordingBrowserResponse,
  CancelOpenBrowserResponse,
} from "@workspace/api-zod";
import { assertResponseShape } from "@/shared/assertResponseShape";
import {
  openBrowser,
  cancelOpenBrowser,
} from "@/features/recording/infrastructure/recordingService";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import {
  requireAdminOrAssignedToCurrentProjectOrOwner,
  requireAdminOrAssignedToCurrentProjectOrOwnerAllowNoProject,
} from "@/shared/middlewares/requireRole";
import { respondValidationError } from "@/shared/validationError";

export function openBrowserRoutes(): IRouter {
  const router = Router();

  router.post(
    "/recording/open-browser",
    requireAdminOrAssignedToCurrentProjectOrOwner,
    async (req, res): Promise<void> => {
      const parsed = OpenRecordingBrowserBody.safeParse(req.body);
      if (!parsed.success) {
        respondValidationError(res, parsed.error);
        return;
      }
      const data = parsed.data;
      const startUrlRaw = data.url?.trim() ?? "";
      if (!startUrlRaw) {
        res.status(400).json({ error: "url is required" });
        return;
      }
      const startUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(startUrlRaw)
        ? startUrlRaw
        : `https://${startUrlRaw}`;
      try {
        new URL(startUrl);
      } catch {
        res.status(400).json({ error: "url must be a valid URL" });
        return;
      }
      let viewport: { width: number; height: number } | undefined;
      if (data.viewport) {
        const w = Math.round(Number(data.viewport.width));
        const h = Math.round(Number(data.viewport.height));
        if (
          !Number.isFinite(w) ||
          !Number.isFinite(h) ||
          w < 320 ||
          w > 3840 ||
          h < 240 ||
          h > 2160
        ) {
          res.status(400).json({
            error:
              "viewport.width must be 320-3840 and viewport.height must be 240-2160",
          });
          return;
        }
        viewport = { width: w, height: h };
      }
      if (!req.user?.id) {
        res.status(401).json({ active: false, message: "Unauthorized" });
        return;
      }
      try {
        const status = await openBrowser({
          url: startUrl,
          viewport,
          userId: req.user.id,
          project: getCurrentProject(req.user.id),
        });
        res.json(
          assertResponseShape(
            OpenRecordingBrowserResponse,
            status,
            "POST /recording/open-browser",
          ),
        );
      } catch (e) {
        res.status(400).json({ active: false, message: (e as Error).message });
      }
    },
  );

  router.post(
    "/recording/cancel-open-browser",
    requireAdminOrAssignedToCurrentProjectOrOwnerAllowNoProject,
    async (req, res): Promise<void> => {
      if (!req.user?.id) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      try {
        const result = await cancelOpenBrowser(req.user.id);
        res.json(
          assertResponseShape(
            CancelOpenBrowserResponse,
            result,
            "POST /recording/cancel-open-browser",
          ),
        );
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    },
  );

  return router;
}

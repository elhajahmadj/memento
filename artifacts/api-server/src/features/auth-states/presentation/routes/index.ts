import { Router, type IRouter } from "express";
import {
  deleteAuthState,
  getAuthStateSummary,
} from "@/features/auth-states/infrastructure/authStateService";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import {
  captureAndSaveAuthState,
  getStatus,
} from "@/features/recording/infrastructure/recordingService";
import { requireAdminOrAssignedToCurrentProjectOrOwner } from "@/shared/middlewares/requireRole";

const router: IRouter = Router();

router.get(
  "/auth-state",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const project = getCurrentProject(req.user.id);
    if (!project) {
      res.status(400).json({ error: "No project loaded" });
      return;
    }
    const summary = await getAuthStateSummary({
      userId: req.user.id,
      projectName: project.solutionName,
    });
    res.json(summary);
  },
);

router.post(
  "/auth-state/save",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const project = getCurrentProject(req.user.id);
    if (!project) {
      res.status(400).json({ error: "No project loaded" });
      return;
    }
    const status = getStatus();
    if (!status.active) {
      res.status(400).json({
        error:
          "Capture login requires a live recording — start one, log in, then call this.",
      });
      return;
    }
    const label =
      typeof req.body?.label === "string" ? String(req.body.label) : "";
    try {
      const summary = await captureAndSaveAuthState({
        userId: req.user.id,
        projectName: project.solutionName,
        label,
      });
      res.json(summary);
    } catch (e) {
      req.log.error({ err: e }, "Failed to capture and save auth state");
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.delete(
  "/auth-state",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const project = getCurrentProject(req.user.id);
    if (!project) {
      res.status(400).json({ error: "No project loaded" });
      return;
    }
    await deleteAuthState({
      userId: req.user.id,
      projectName: project.solutionName,
    });
    res.json({ ok: true });
  },
);

export default router;

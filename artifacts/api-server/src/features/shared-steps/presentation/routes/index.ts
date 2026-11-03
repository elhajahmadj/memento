import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  deleteSharedStep,
  listSharedSteps,
  upsertSharedStep,
} from "@/features/shared-steps/infrastructure/sharedStepsService";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import { requireAdminOrAssignedToCurrentProjectOrOwner } from "@/shared/middlewares/requireRole";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

const SharedStepNameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9 _-]*$/, {
    message:
      "Name must start with a letter and contain only letters, digits, spaces, hyphens or underscores.",
  });

const UpsertBodySchema = z.object({
  name: SharedStepNameSchema,
  description: z.string().max(500).optional().default(""),
  actions: z.array(z.any()).min(1),
});

router.get(
  "/shared-steps",
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
    const items = await listSharedSteps({
      userId: req.user.id,
      projectName: project.solutionName,
    });
    res.json({ items });
  },
);

router.post(
  "/shared-steps",
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
    const parsed = UpsertBodySchema.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    try {
      const item = await upsertSharedStep({
        userId: req.user.id,
        projectName: project.solutionName,
        name: parsed.data.name.trim(),
        description: parsed.data.description ?? "",
        actions: parsed.data.actions as RecordedAction[],
      });
      res.json({ item });
    } catch (e) {
      req.log.error({ err: e }, "Failed to upsert shared step");
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.delete(
  "/shared-steps/:name",
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
    const name = String(req.params.name ?? "");
    const removed = await deleteSharedStep({
      userId: req.user.id,
      projectName: project.solutionName,
      name,
    });
    if (!removed) {
      res.status(404).json({ error: "Shared step not found" });
      return;
    }
    res.json({ ok: true });
  },
);

export default router;

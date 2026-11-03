import { Router, type IRouter } from "express";
import { GeneratePipelineFileBody } from "@workspace/api-zod";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getCurrentProject,
  writeFile,
} from "@/features/projects/infrastructure/projectService";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import {
  buildPipelineFile,
  pipelineFilePath,
} from "@/features/projects/infrastructure/pipelineTemplates";
import { requireAdminOrAssignedToCurrentProjectOrOwner } from "@/shared/middlewares/requireRole";
import { listForksForUser } from "@/features/forks/infrastructure/forkService";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

router.post(
  "/projects/pipeline-file",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    const user = req.user!;
    const project = getCurrentProject(user.id);
    if (!project) {
      res.status(404).json({ error: "No project loaded" });
      return;
    }
    // Defense-in-depth for limited (non-admin) users: even though
    // /projects/load only lets them load their own active fork, verify
    // here that the loaded project's root actually corresponds to one
    // of their active forks. This way the endpoint can't be abused if
    // a limited user's current project ever gets set out-of-band.
    if (user.role !== "admin" && user.role !== "limited_admin") {
      const forks = await listForksForUser(user.id);
      const projectRoot = path.resolve(project.rootPath);
      const ownsLoadedFork = forks.some(
        (f) =>
          f.status === "active" && path.resolve(f.forkPath) === projectRoot,
      );
      if (!ownsLoadedFork) {
        res.status(403).json({
          error:
            "You do not have an active fork for the loaded project.",
        });
        return;
      }
    }
    const parsed = GeneratePipelineFileBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const { platform, mode, overwrite } = parsed.data;
    const relPath = pipelineFilePath(platform);

    try {
      const abs = safeJoin(project.rootPath, relPath);
      if (!overwrite) {
        try {
          await fs.access(abs);
          res.status(409).json({ exists: true, path: relPath });
          return;
        } catch {
          // file does not exist — fall through to write
        }
      }
      const content = buildPipelineFile({
        platform,
        mode,
        language: project.language ?? "csharp",
        solutionName: project.solutionName,
      });
      await writeFile(project, relPath, content);
      res.status(201).json({ path: relPath });
    } catch (e) {
      req.log.error({ err: e }, "Failed to generate pipeline file");
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

export default router;

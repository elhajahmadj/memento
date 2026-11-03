import path from "node:path";
import {
  err,
  ok,
  type AppError,
  type Result,
  validationError,
  notFoundError,
} from "@workspace/kernel";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import type { ProjectRepository } from "../../domain/ports/projectRepository";
import type { Project } from "../../domain/types";
import { setCurrentProject } from "../../infrastructure/repositories/currentProjectStore";
import { makeDetectProjectInfo } from "./detectProjectInfo";

export function makeLoadProject(deps: { repo: ProjectRepository }) {
  const detect = makeDetectProjectInfo(deps);
  return async function execute(
    slnPath: string,
    userId?: string | null,
  ): Promise<Result<Project, AppError>> {
    const abs = path.resolve(slnPath);
    const wsRoot = path.resolve(recorderConfig.workspaceDir);
    if (!abs.startsWith(wsRoot + path.sep)) {
      return err(
        validationError("Solution must live inside the workspace folder"),
      );
    }
    try {
      await deps.repo.assertExists(abs);
    } catch {
      return err(notFoundError("project", slnPath));
    }
    const detected = await detect(abs);
    if (detected.kind === "err") return detected;
    setCurrentProject(detected.value, userId);
    return ok(detected.value);
  };
}

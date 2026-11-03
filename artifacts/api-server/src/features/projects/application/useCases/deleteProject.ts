import path from "node:path";
import { ok, type AppError, type Result } from "@workspace/kernel";
import type { ProjectRepository } from "../../domain/ports/projectRepository";
import { projectDirFromSlnPath } from "../../domain/paths";
import {
  deleteCurrentProjectByKey,
  forEachCurrentProject,
} from "../../infrastructure/repositories/currentProjectStore";

export function makeDeleteProject(deps: { repo: ProjectRepository }) {
  return async function execute(
    slnPath: string,
  ): Promise<Result<void, AppError>> {
    const dir = projectDirFromSlnPath(slnPath);
    const resolvedSln = path.resolve(slnPath);
    forEachCurrentProject((key, current) => {
      if (path.resolve(current.slnPath) === resolvedSln) {
        deleteCurrentProjectByKey(key);
      }
    });
    await deps.repo.deleteProjectDir(dir);
    return ok(undefined);
  };
}

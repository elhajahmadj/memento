import { ok, type AppError, type Result } from "@workspace/kernel";
import type { ProjectRepository } from "../../domain/ports/projectRepository";
import type { Project } from "../../domain/types";

export function makeListApiBaseUrls(deps: { repo: ProjectRepository }) {
  return async function execute(
    project: Project,
  ): Promise<Result<Array<{ name: string; baseUrl: string }>, AppError>> {
    return ok(await deps.repo.listApiBaseUrls(project));
  };
}

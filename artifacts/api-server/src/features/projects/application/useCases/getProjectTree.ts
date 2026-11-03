import { ok, type AppError, type Result } from "@workspace/kernel";
import type { ProjectRepository } from "../../domain/ports/projectRepository";
import type { Project, TreeNode } from "../../domain/types";

export function makeGetProjectTree(deps: { repo: ProjectRepository }) {
  return async function execute(
    project: Project,
  ): Promise<Result<TreeNode, AppError>> {
    return ok(await deps.repo.buildTree(project.rootPath));
  };
}

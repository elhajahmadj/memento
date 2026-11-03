import {
  ok,
  type AppError,
  type Result,
} from "@workspace/kernel";
import type { ProjectRepository } from "../../domain/ports/projectRepository";
import type { ProjectListing } from "../../domain/types";

export function makeListAvailableProjects(deps: { repo: ProjectRepository }) {
  return async function execute(): Promise<
    Result<ProjectListing[], AppError>
  > {
    const list = await deps.repo.listAvailableProjects();
    return ok(list);
  };
}

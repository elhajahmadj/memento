import path from "node:path";
import {
  err,
  ok,
  type AppError,
  type Result,
  notFoundError,
} from "@workspace/kernel";
import {
  normalizeLanguage,
  type Language,
} from "@/features/architectures/infrastructure/architectureService";
import type { ProjectRepository } from "../../domain/ports/projectRepository";
import {
  isJavaProjectFilePath,
  isNodejsProjectFilePath,
  isPythonProjectFilePath,
  projectDirFromSlnPath,
} from "../../domain/paths";

export interface SetProjectDisabledOutput {
  slnPath: string;
  solutionName: string;
  disabled: boolean;
  language: Language;
}

export function makeSetProjectDisabled(deps: { repo: ProjectRepository }) {
  return async function execute(
    slnPath: string,
    disabled: boolean,
  ): Promise<Result<SetProjectDisabledOutput, AppError>> {
    const dir = projectDirFromSlnPath(slnPath);
    try {
      await deps.repo.assertExists(slnPath);
    } catch {
      return err(notFoundError("project", slnPath));
    }
    await deps.repo.setDisabled(dir, disabled);

    const isPython = isPythonProjectFilePath(slnPath);
    const isNodejs = isNodejsProjectFilePath(slnPath);
    const isJava = isJavaProjectFilePath(slnPath);
    const projectMarker = await deps.repo.readMarker(dir);
    const inferred: Language = isPython
      ? "python"
      : isNodejs
        ? "nodejs"
        : isJava
          ? "java"
          : "csharp";
    const language: Language = normalizeLanguage(
      projectMarker?.language ?? inferred,
    );
    const solutionName =
      isPython || isNodejs || isJava
        ? projectMarker?.solutionName ?? path.basename(dir)
        : path.basename(slnPath, ".sln");
    return ok({ slnPath, solutionName, disabled, language });
  };
}

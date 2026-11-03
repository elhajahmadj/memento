import path from "node:path";
import {
  ok,
  type AppError,
  type Result,
} from "@workspace/kernel";
import {
  normalizeLanguage,
  type Language,
} from "@/features/architectures/infrastructure/architectureService";
import type { ProjectRepository } from "../../domain/ports/projectRepository";
import {
  isJavaProjectFilePath,
  isJmxProjectFilePath,
  isNodejsProjectFilePath,
  isPythonProjectFilePath,
  projectDirFromSlnPath,
} from "../../domain/paths";
import {
  javaTestsModuleName,
  nodejsPackageName,
  pythonTestPackageName,
} from "../../domain/naming";
import {
  normalizeSolutionType,
  type Project,
} from "../../domain/types";
import { clearCsharpFiles } from "../../infrastructure/clearers/csharpClearer";
import { clearPythonFiles } from "../../infrastructure/clearers/pythonClearer";
import { clearNodejsFiles } from "../../infrastructure/clearers/nodejsClearer";
import { clearJavaFiles } from "../../infrastructure/clearers/javaClearer";
import { clearJmxFiles } from "../../infrastructure/clearers/jmxClearer";

export function makeClearProjectFiles(deps: { repo: ProjectRepository }) {
  return async function execute(
    slnPath: string,
  ): Promise<Result<void, AppError>> {
    const dir = projectDirFromSlnPath(slnPath);
    await deps.repo.assertExists(slnPath);

    const isPython = isPythonProjectFilePath(slnPath);
    const isNodejs = isNodejsProjectFilePath(slnPath);
    const isJava = isJavaProjectFilePath(slnPath);
    const isJmx = isJmxProjectFilePath(slnPath);
    const projectMarker = await deps.repo.readMarker(dir);
    const inferred: Language = isPython
      ? "python"
      : isNodejs
        ? "nodejs"
        : isJava
          ? "java"
          : isJmx
            ? "jmx"
            : "csharp";
    const language: Language = normalizeLanguage(
      projectMarker?.language ?? inferred,
    );
    const solutionName =
      isPython || isNodejs || isJava || isJmx
        ? projectMarker?.solutionName ?? path.basename(dir)
        : path.basename(slnPath, ".sln");
    const namespace = projectMarker?.namespace ?? solutionName;
    const testProjectName =
      projectMarker?.testProjectName ??
      (language === "csharp"
        ? `${solutionName}.Tests`
        : language === "python"
          ? pythonTestPackageName(solutionName)
          : language === "nodejs"
            ? nodejsPackageName(solutionName)
            : language === "jmx"
              ? solutionName
              : javaTestsModuleName(solutionName));

    const project: Project = {
      solutionName,
      testProjectName,
      namespace,
      rootPath: dir,
      slnPath,
      language,
      solutionType: normalizeSolutionType(projectMarker?.solutionType),
    };

    switch (language) {
      case "csharp":
        await clearCsharpFiles(project);
        break;
      case "python":
        await clearPythonFiles(project);
        break;
      case "nodejs":
        await clearNodejsFiles(project);
        break;
      case "java":
        await clearJavaFiles(project);
        break;
      case "jmx":
        await clearJmxFiles(project);
        break;
    }

    // Regenerate per-language TestConfig so the empty-URL state takes
    // effect. Best-effort — the recording flow handles this on its own
    // path too.
    try {
      const codegenAdapter = await import(
        "@/features/codegen/infrastructure/codegenAdapter"
      );
      await codegenAdapter.regenerateTestConfig(project);
    } catch {
      // ignored — sidecar
    }
    return ok(undefined);
  };
}

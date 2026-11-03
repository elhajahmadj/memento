import path from "node:path";
import {
  err,
  ok,
  type AppError,
  type Result,
  fromPromise,
  unauthorizedError,
} from "@workspace/kernel";
import {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  type Language,
} from "@/features/architectures/infrastructure/architectureService";
import type { ProjectRepository } from "../../domain/ports/projectRepository";
import {
  isJavaProjectFilePath,
  isJmxProjectFilePath,
  isNodejsProjectFilePath,
  isPythonProjectFilePath,
} from "../../domain/paths";
import {
  javaPackageName,
  javaTestsModuleName,
  nodejsPackageName,
  pythonPackageName,
  pythonTestPackageName,
  testsProjectName,
} from "../../domain/naming";
import {
  normalizeSolutionType,
  type Project,
} from "../../domain/types";

/**
 * Detect a project on disk from its sln/marker path. Reads the project
 * marker through the repository port and falls back to per-language
 * heuristics when the marker is missing (legacy projects).
 */
export function makeDetectProjectInfo(deps: { repo: ProjectRepository }) {
  return async function execute(
    slnPath: string,
  ): Promise<Result<Project, AppError>> {
    const rootPath = path.dirname(slnPath);
    const isPython = isPythonProjectFilePath(slnPath);
    const isNodejs = isNodejsProjectFilePath(slnPath);
    const isJava = isJavaProjectFilePath(slnPath);
    const isJmx = isJmxProjectFilePath(slnPath);
    const fallbackSolutionName =
      isPython || isNodejs || isJava || isJmx
        ? path.basename(rootPath)
        : path.basename(slnPath, ".sln");

    const markerResult = await fromPromise(
      deps.repo.readMarker(rootPath),
      (e: unknown) => unauthorizedError((e as Error).message),
    );
    if (markerResult.kind === "err") return err(markerResult.error);
    const marker = markerResult.value;
    if (marker) {
      const language: Language = normalizeLanguage(marker.language);
      const base = {
        solutionName: marker.solutionName ?? fallbackSolutionName,
        testProjectName: marker.testProjectName,
        namespace: marker.namespace,
        rootPath,
        slnPath,
        language,
        solutionType: normalizeSolutionType(marker.solutionType),
      };
      if (language === "jmx") {
        return ok({
          ...base,
          jmxFiles: Array.isArray(marker.jmxFiles) ? marker.jmxFiles : [],
          jmxEmbedCredentials: marker.jmxExport?.embedCredentials === true,
          ...(typeof marker.targetUrl === "string" && marker.targetUrl
            ? { targetUrl: marker.targetUrl }
            : {}),
          ...(typeof marker.jwtAuth === "boolean"
            ? { jwtAuth: marker.jwtAuth }
            : {}),
          ...(typeof marker.bff === "boolean"
            ? { bff: marker.bff }
            : {}),
        });
      }
      return ok(base);
    }

    if (isPython) {
      const pkg = pythonPackageName(fallbackSolutionName);
      return ok({
        solutionName: fallbackSolutionName,
        testProjectName: pythonTestPackageName(fallbackSolutionName),
        namespace: pkg,
        rootPath,
        slnPath,
        language: "python",
        solutionType: "playwright",
      });
    }

    if (isNodejs) {
      const pkg = nodejsPackageName(fallbackSolutionName);
      return ok({
        solutionName: fallbackSolutionName,
        testProjectName: pkg,
        namespace: pkg,
        rootPath,
        slnPath,
        language: "nodejs",
        solutionType: "playwright",
      });
    }

    if (isJmx) {
      return ok({
        solutionName: fallbackSolutionName,
        testProjectName: fallbackSolutionName,
        namespace: fallbackSolutionName,
        rootPath,
        slnPath,
        language: "jmx",
        solutionType: "playwright",
      });
    }

    if (isJava) {
      const pkg = javaPackageName(fallbackSolutionName);
      return ok({
        solutionName: fallbackSolutionName,
        testProjectName: javaTestsModuleName(fallbackSolutionName),
        namespace: pkg,
        rootPath,
        slnPath,
        language: "java",
        solutionType: "playwright",
      });
    }

    const solutionName = fallbackSolutionName;
    const namespace = await deps.repo.detectLegacyCsharpNamespace(
      rootPath,
      solutionName,
    );
    return ok({
      solutionName,
      testProjectName: testsProjectName(solutionName),
      namespace,
      rootPath,
      slnPath,
      language: DEFAULT_LANGUAGE,
      solutionType: "playwright",
    });
  };
}

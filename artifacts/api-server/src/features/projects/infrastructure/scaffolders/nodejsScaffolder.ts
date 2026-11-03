import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import { applyTokens } from "@/features/codegen/infrastructure/templates";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import type { Architecture } from "@/features/architectures/infrastructure/architectureService";
import { NODEJS_PROJECT_FILE } from "../../domain/paths";
import { nodejsPackageName } from "../../domain/naming";
import type { Project, ProjectMarker } from "../../domain/types";
import { writeFolderRecursive, writeProjectMarker } from "./shared";

/**
 * Scaffold a Node.js project from an architecture. Like the Python
 * scaffolder, every `ArchProject` is collapsed into a single root
 * directory because the `@playwright/test` layout is one npm package
 * rooted at `package.json`.
 */
export async function scaffoldNodejsFromArchitecture(
  validated: Architecture,
  solutionName: string,
  namespace: string,
): Promise<Project> {
  const pkg = nodejsPackageName(solutionName);
  const vars = {
    namespace,
    solution: solutionName,
    package: pkg,
    testPackage: pkg,
  };

  await fs.mkdir(recorderConfig.workspaceDir, { recursive: true });
  const rootPath = path.join(recorderConfig.workspaceDir, solutionName);
  await fs.mkdir(rootPath, { recursive: true });

  const slnPath = path.join(rootPath, NODEJS_PROJECT_FILE);

  for (const archProject of validated.projects) {
    for (const f of archProject.files) {
      const fileName = applyTokens(f.name, vars);
      await fs.writeFile(
        safeJoin(rootPath, fileName),
        applyTokens(f.content, vars),
      );
    }
    for (const folder of archProject.folders) {
      await writeFolderRecursive(rootPath, rootPath, folder, vars);
    }
  }

  const marker: ProjectMarker = {
    architectureId: validated.id,
    testProjectName: pkg,
    namespace,
    solutionName,
    language: "nodejs",
  };
  await writeProjectMarker(rootPath, marker);

  return {
    solutionName,
    testProjectName: pkg,
    namespace,
    rootPath,
    slnPath,
    language: "nodejs",
    solutionType: "playwright",
  };
}

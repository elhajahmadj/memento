import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import { applyTokens } from "@/features/codegen/infrastructure/templates";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import type { Architecture } from "@/features/architectures/infrastructure/architectureService";
import { PYTHON_PROJECT_FILE } from "../../domain/paths";
import {
  pythonPackageName,
  pythonTestPackageName,
} from "../../domain/naming";
import type { Project, ProjectMarker } from "../../domain/types";
import { writeFolderRecursive, writeProjectMarker } from "./shared";

/**
 * Scaffold a Python project from an architecture.
 *
 * Python projects intentionally collapse the architecture's "projects"
 * (Shared / Infrastructure / Tests) into a single root directory because
 * Python prefers package-per-folder over project-per-directory. Files
 * and folders from every `ArchProject` are written directly under
 * `rootPath` regardless of `nameSuffix`, producing an idiomatic layout.
 */
export async function scaffoldPythonFromArchitecture(
  validated: Architecture,
  solutionName: string,
  namespace: string,
): Promise<Project> {
  const pkg = pythonPackageName(solutionName);
  const testPkg = pythonTestPackageName(solutionName);
  const vars = {
    namespace,
    solution: solutionName,
    package: pkg,
    testPackage: testPkg,
  };

  await fs.mkdir(recorderConfig.workspaceDir, { recursive: true });
  const rootPath = path.join(recorderConfig.workspaceDir, solutionName);
  await fs.mkdir(rootPath, { recursive: true });

  // Synthetic "slnPath" for Python: points at the root pyproject.toml so the
  // existing API surface (which keys projects by `slnPath`) still works.
  const slnPath = path.join(rootPath, PYTHON_PROJECT_FILE);

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
    testProjectName: testPkg,
    namespace,
    solutionName,
    language: "python",
  };
  await writeProjectMarker(rootPath, marker);

  return {
    solutionName,
    testProjectName: testPkg,
    namespace,
    rootPath,
    slnPath,
    language: "python",
    solutionType: "playwright",
  };
}

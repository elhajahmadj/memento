import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import { applyTokens } from "@/features/codegen/infrastructure/templates";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import type { Architecture } from "@/features/architectures/infrastructure/architectureService";
import type { Project, ProjectMarker } from "../../domain/types";
import {
  generateSlnContent,
  minimalCsprojContent,
  projectHasCsproj,
  writeFolderRecursive,
  writeProjectMarker,
} from "./shared";

export async function scaffoldCsharpFromArchitecture(
  validated: Architecture,
  solutionName: string,
  namespace: string,
): Promise<Project> {
  const vars = { namespace, solution: solutionName };

  await fs.mkdir(recorderConfig.workspaceDir, { recursive: true });
  const rootPath = path.join(recorderConfig.workspaceDir, solutionName);
  await fs.mkdir(rootPath, { recursive: true });

  const slnPath = path.join(rootPath, `${solutionName}.sln`);
  await fs.writeFile(slnPath, generateSlnContent(solutionName, validated));

  let testsProjectName = `${solutionName}.Tests`;
  for (const archProject of validated.projects) {
    const projectName = `${solutionName}${archProject.nameSuffix}`;
    const projectDir = safeJoin(rootPath, projectName);
    await fs.mkdir(projectDir, { recursive: true });

    if (archProject.isTestsProject) {
      testsProjectName = projectName;
    }

    // Auto-generate a minimal .csproj if the architecture didn't provide one.
    if (!projectHasCsproj(archProject, solutionName)) {
      await fs.writeFile(
        safeJoin(projectDir, `${projectName}.csproj`),
        minimalCsprojContent(),
      );
    }

    for (const f of archProject.files) {
      const fileName = applyTokens(f.name, vars);
      await fs.writeFile(
        safeJoin(projectDir, fileName),
        applyTokens(f.content, vars),
      );
    }
    for (const folder of archProject.folders) {
      await writeFolderRecursive(rootPath, projectDir, folder, vars);
    }
  }

  const marker: ProjectMarker = {
    architectureId: validated.id,
    testProjectName: testsProjectName,
    namespace,
    solutionName,
    language: "csharp",
  };
  await writeProjectMarker(rootPath, marker);

  return {
    solutionName,
    testProjectName: testsProjectName,
    namespace,
    rootPath,
    slnPath,
    language: "csharp",
    solutionType: "playwright",
  };
}

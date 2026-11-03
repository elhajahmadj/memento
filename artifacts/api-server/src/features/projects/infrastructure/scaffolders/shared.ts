import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import { applyTokens } from "@/features/codegen/infrastructure/templates";
import type {
  ArchFolder,
  ArchProject,
} from "@/features/architectures/infrastructure/architectureService";
import { PROJECT_MARKER_FILE } from "../../domain/paths";
import type { ProjectMarker } from "../../domain/types";

export interface ScaffoldTokens {
  namespace: string;
  solution: string;
  package?: string;
  testPackage?: string;
}

const CSHARP_PROJECT_TYPE_GUID = "{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}";

export function generateSlnContent(
  solutionName: string,
  arch: { projects: ReadonlyArray<{ nameSuffix: string; slnGuid: string }> },
): string {
  const projects = arch.projects.map((p) => ({
    name: `${solutionName}${p.nameSuffix}`,
    guid: p.slnGuid,
  }));

  const projectEntries = projects
    .map(
      (p) =>
        `Project("${CSHARP_PROJECT_TYPE_GUID}") = "${p.name}", "${p.name}\\${p.name}.csproj", "${p.guid}"\nEndProject`,
    )
    .join("\n");

  const cfgLines = projects
    .flatMap((p) => [
      `\t\t${p.guid}.Debug|Any CPU.ActiveCfg = Debug|Any CPU`,
      `\t\t${p.guid}.Debug|Any CPU.Build.0 = Debug|Any CPU`,
      `\t\t${p.guid}.Release|Any CPU.ActiveCfg = Release|Any CPU`,
      `\t\t${p.guid}.Release|Any CPU.Build.0 = Release|Any CPU`,
    ])
    .join("\n");

  return `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.0.31903.59
MinimumVisualStudioVersion = 10.0.40219.1
${projectEntries}
Global
\tGlobalSection(SolutionConfigurationPlatforms) = preSolution
\t\tDebug|Any CPU = Debug|Any CPU
\t\tRelease|Any CPU = Release|Any CPU
\tEndGlobalSection
\tGlobalSection(ProjectConfigurationPlatforms) = postSolution
${cfgLines}
\tEndGlobalSection
\tGlobalSection(SolutionProperties) = preSolution
\t\tHideSolutionNode = FALSE
\tEndGlobalSection
EndGlobal
`;
}

export function minimalCsprojContent(): string {
  return `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="NUnit" Version="4.2.2" />
  </ItemGroup>

</Project>
`;
}

export function projectHasCsproj(
  project: ArchProject,
  solutionName: string,
): boolean {
  const expected = `${solutionName}${project.nameSuffix}.csproj`;
  const expectedTemplated = `{{Solution}}${project.nameSuffix}.csproj`;
  return project.files.some(
    (f) => f.name === expected || f.name === expectedTemplated,
  );
}

export async function writeFolderRecursive(
  rootPath: string,
  baseDir: string,
  folder: ArchFolder,
  vars: ScaffoldTokens,
): Promise<void> {
  // When baseDir === rootPath (Python projects write top-level folders
  // directly under the workspace root), `path.relative(...)` returns ""
  // and naive concatenation would emit a leading separator that
  // `safeJoin` rejects as an absolute path. Compose the relative path
  // explicitly via `path.posix.join` so the empty-base case becomes
  // simply `folder.name`. Folder names are passed through `applyTokens`
  // so architectures can template path segments (e.g. `{{Package}}`).
  const folderName = applyTokens(folder.name, vars);
  const baseRel = path.relative(rootPath, baseDir).replace(/\\/g, "/");
  const relDir = baseRel ? path.posix.join(baseRel, folderName) : folderName;
  const dir = safeJoin(rootPath, relDir);
  await fs.mkdir(dir, { recursive: true });
  const hasContent = folder.files.length > 0 || folder.folders.length > 0;
  for (const f of folder.files) {
    const fileName = applyTokens(f.name, vars);
    const target = safeJoin(rootPath, path.posix.join(relDir, fileName));
    await fs.writeFile(target, applyTokens(f.content, vars));
  }
  for (const sub of folder.folders) {
    await writeFolderRecursive(rootPath, dir, sub, vars);
  }
  if (!hasContent) {
    await fs.writeFile(path.join(dir, ".gitkeep"), "");
  }
}

export async function writeProjectMarker(
  rootPath: string,
  marker: ProjectMarker,
): Promise<void> {
  await fs.writeFile(
    path.join(rootPath, PROJECT_MARKER_FILE),
    JSON.stringify(marker, null, 2),
  );
}

import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "../../domain/types";
import {
  clearDirContents,
  deleteBakFilesIn,
  resetAppsettingsUrls,
} from "./shared";

export async function clearCsharpFiles(project: Project): Promise<void> {
  const isApi = (project.solutionType ?? "playwright") === "api";
  const testsRoot = safeJoin(project.rootPath, project.testProjectName);

  if (isApi) {
    const { apiEndpointsCs, API_HELPER_SUFFIX } = await import(
      "@/features/projects/infrastructure/apiCsharpScaffolder"
    );
    const helperDir = safeJoin(
      project.rootPath,
      `${project.solutionName}${API_HELPER_SUFFIX}`,
    );
    const endpointsAbs = path.join(helperDir, "Constants", "ApiEndpoints.cs");
    try {
      await fs.access(endpointsAbs);
      await fs.writeFile(endpointsAbs, apiEndpointsCs(project.namespace));
    } catch {
      // missing — leave alone
    }
  }
  const subDirs = [
    "Tests",
    "Constants",
    "TestCategories",
    "SharedSteps",
    "APITestingAssistants",
    path.join("PageObjects", "Selectors"),
    path.join("PageObjects", "Interfaces"),
    path.join("PageObjects", "Actions"),
  ];
  for (const sub of subDirs) {
    await clearDirContents(project.rootPath, path.join(testsRoot, sub));
  }
  await deleteBakFilesIn(project.rootPath, testsRoot);
  await resetAppsettingsUrls(path.join(testsRoot, "appsettings.json"));
}

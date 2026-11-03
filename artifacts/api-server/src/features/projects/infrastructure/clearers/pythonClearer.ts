import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "../../domain/types";
import {
  clearDirContents,
  clearGeneratedTestFiles,
  resetAppsettingsUrls,
  stripUrlEnvLines,
} from "./shared";

export async function clearPythonFiles(project: Project): Promise<void> {
  const isApi = (project.solutionType ?? "playwright") === "api";
  const testsDir = safeJoin(project.rootPath, "tests");

  if (isApi) {
    await clearGeneratedTestFiles(
      project.rootPath,
      path.join(testsDir, "tests"),
      (name) => /^test_.*\.py$/.test(name),
    );
    for (const sub of [
      "api_testing_assistants",
      "constants",
      "test_categories",
    ]) {
      await clearDirContents(project.rootPath, path.join(testsDir, sub));
    }
    await resetAppsettingsUrls(path.join(testsDir, "appsettings.json"));
    const { apiEndpointsPy, API_PYTHON_HELPER_DIR } = await import(
      "@/features/projects/infrastructure/apiPythonScaffolder"
    );
    const endpointsAbs = path.join(
      project.rootPath,
      API_PYTHON_HELPER_DIR,
      "constants",
      "api_endpoints.py",
    );
    try {
      await fs.access(endpointsAbs);
      await fs.writeFile(endpointsAbs, apiEndpointsPy());
    } catch {
      // missing — leave alone
    }
  } else {
    await clearGeneratedTestFiles(
      project.rootPath,
      testsDir,
      (name) => /^test_.*\.py$/.test(name) && name !== "test_smoke.py",
    );
    for (const sub of [
      "pages/selectors",
      "pages/actions",
      "constants",
      "test_categories",
    ]) {
      await clearDirContents(
        project.rootPath,
        safeJoin(project.rootPath, sub),
      );
    }
  }

  await stripUrlEnvLines(project);
}

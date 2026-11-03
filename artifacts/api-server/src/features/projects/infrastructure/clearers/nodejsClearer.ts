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

export async function clearNodejsFiles(project: Project): Promise<void> {
  const isApi = (project.solutionType ?? "playwright") === "api";
  const testsDir = safeJoin(project.rootPath, "tests");

  if (isApi) {
    await clearGeneratedTestFiles(
      project.rootPath,
      path.join(testsDir, "tests"),
      (name) => name.endsWith(".spec.ts"),
    );
    for (const sub of [
      "api-testing-assistants",
      "constants",
      "test-categories",
    ]) {
      await clearDirContents(project.rootPath, path.join(testsDir, sub));
    }
    await resetAppsettingsUrls(path.join(testsDir, "appsettings.json"));
    const { apiEndpointsTs, NODEJS_API_HELPER_DIR } = await import(
      "@/features/projects/infrastructure/apiNodejsScaffolder"
    );
    const endpointsAbs = path.join(
      project.rootPath,
      NODEJS_API_HELPER_DIR,
      "constants",
      "api-endpoints.ts",
    );
    try {
      await fs.access(endpointsAbs);
      await fs.writeFile(endpointsAbs, apiEndpointsTs());
    } catch {
      // missing — leave alone
    }
  } else {
    await clearGeneratedTestFiles(
      project.rootPath,
      testsDir,
      (name) => name.endsWith(".spec.ts") && name !== "smoke.spec.ts",
    );
    for (const sub of ["pages/selectors", "pages/actions", "constants"]) {
      await clearDirContents(
        project.rootPath,
        safeJoin(project.rootPath, sub),
      );
    }
  }

  await stripUrlEnvLines(project);
}

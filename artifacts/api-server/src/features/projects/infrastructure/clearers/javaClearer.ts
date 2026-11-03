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

export async function clearJavaFiles(project: Project): Promise<void> {
  const isApi = (project.solutionType ?? "playwright") === "api";
  const testsModule = safeJoin(project.rootPath, project.testProjectName);

  if (isApi) {
    const { javaApiPackageSegment } = await import(
      "@/features/projects/infrastructure/apiJavaScaffolder"
    );
    const pkg = javaApiPackageSegment(project.solutionName);
    const apiTestsRoot = path.join(
      testsModule,
      "src",
      "test",
      "java",
      "com",
      pkg,
      "automation",
      "api",
      "tests",
    );
    for (const sub of [
      "tests",
      "apitestingassistants",
      "constants",
      "testcategories",
    ]) {
      await clearDirContents(project.rootPath, path.join(apiTestsRoot, sub));
    }
    await resetAppsettingsUrls(
      path.join(testsModule, "src", "test", "resources", "appsettings.json"),
    );
    const { apiEndpointsJava, javaApiHelperModule, javaApiBasePackage } =
      await import("@/features/projects/infrastructure/apiJavaScaffolder");
    const helperModule = safeJoin(
      project.rootPath,
      javaApiHelperModule(project.solutionName),
    );
    const basePkg = javaApiBasePackage(project.solutionName);
    const endpointsAbs = path.join(
      helperModule,
      "src",
      "main",
      "java",
      "com",
      pkg,
      "automation",
      "api",
      "constants",
      "ApiEndpoints.java",
    );
    try {
      await fs.access(endpointsAbs);
      await fs.writeFile(endpointsAbs, apiEndpointsJava(basePkg));
    } catch {
      // missing — leave alone
    }
  } else {
    const testJavaRoot = path.join(
      testsModule,
      "src",
      "test",
      "java",
      project.namespace,
    );
    await clearGeneratedTestFiles(
      project.rootPath,
      path.join(testJavaRoot, "tests"),
      (name) => name.endsWith(".java") && name !== "ExampleTest.java",
    );
    for (const sub of [
      path.join("pages", "selectors"),
      path.join("pages", "actions"),
      "constants",
      "testcategories",
    ]) {
      await clearDirContents(project.rootPath, path.join(testJavaRoot, sub));
    }
    const sharedModule = safeJoin(
      project.rootPath,
      `${project.solutionName}-shared`,
    );
    await clearDirContents(
      project.rootPath,
      path.join(
        sharedModule,
        "src",
        "main",
        "java",
        project.namespace,
        "pages",
        "interfaces",
      ),
    );
  }

  await stripUrlEnvLines(project);
}

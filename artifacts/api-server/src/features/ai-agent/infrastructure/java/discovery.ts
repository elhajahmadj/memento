import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import { exists, javaPackageName } from "./helpers";
import type { JavaTarget } from "./types";

export async function discoverJavaTarget(
  projectRoot: string,
  projectName: string,
): Promise<JavaTarget> {
  // Prefer the marker file written by scaffoldJavaFromArchitecture.
  const markerAbs = safeJoin(projectRoot, ".testbuilder.json");
  let testsModuleName = `${projectName}-tests`;
  let pkg = javaPackageName(projectName);
  try {
    const txt = await fs.readFile(markerAbs, "utf8");
    const parsed = JSON.parse(txt) as {
      testProjectName?: string;
      namespace?: string;
    };
    if (parsed.testProjectName) testsModuleName = parsed.testProjectName;
    if (parsed.namespace) pkg = parsed.namespace;
  } catch {
    // fall back to defaults
  }
  // Confirm dir exists; if not, scan workspace for a `*-tests` sibling.
  const candidateAbs = safeJoin(projectRoot, testsModuleName);
  if (!(await exists(candidateAbs))) {
    try {
      const entries = await fs.readdir(projectRoot, { withFileTypes: true });
      const fallback = entries
        .filter((e) => e.isDirectory() && e.name.endsWith("-tests"))
        .map((e) => e.name)[0];
      if (fallback) testsModuleName = fallback;
    } catch {
      // leave default
    }
  }
  return {
    testsModuleDir: safeJoin(projectRoot, testsModuleName),
    testsModuleRel: testsModuleName,
    pkg,
  };
}

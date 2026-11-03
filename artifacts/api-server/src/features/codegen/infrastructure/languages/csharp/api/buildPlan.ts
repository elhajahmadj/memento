import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type {
  BuildApiTestPlan,
  BuildApiTestPlanFile,
  BuildApiTestSpec,
  ProjectLike,
} from "./types";
import { HTTP_VERBS } from "./types";
import {
  apiSuiteConstantsClassName,
  apiSuiteTestCategoriesClassName,
  helperProjectName,
  ident,
  readOrEmpty,
  relPosix,
  renderApiSuiteConstantsFile,
  testProjectName,
  upsertApiTestCategoryConstant,
} from "./naming";
import { upsertEndpointConstant } from "./endpointConstants";
import {
  assistantClassNameFor,
  renderNewAssistantFile,
  upsertHelperMethod,
} from "./helperMethod";
import {
  insertFactIntoExistingClass,
  renderNewTestClass,
} from "./testClass";
import { mergeAppSettings } from "./appsettings";

/**
 * Plan the four file writes for a Build Test invocation, *without* writing
 * to disk. Used both by tests and by the route, which then commits the
 * plan atomically.
 */
export async function planApiTestBuild(
  project: ProjectLike,
  spec: BuildApiTestSpec,
): Promise<BuildApiTestPlan> {
  if (!HTTP_VERBS.includes(spec.httpMethod)) {
    throw new Error(`Unsupported HTTP verb: ${spec.httpMethod}`);
  }
  if (spec.parameters.length > 10) {
    throw new Error("Helper methods accept at most 10 parameters");
  }

  const helperDir = safeJoin(
    project.rootPath,
    helperProjectName(project.solutionName),
  );
  const testsDir = safeJoin(
    project.rootPath,
    testProjectName(project.solutionName),
  );

  const endpointsAbs = path.join(helperDir, "Constants", "ApiEndpoints.cs");
  const appsettingsAbs = path.join(testsDir, "appsettings.json");

  const endpointsSrc = (await readOrEmpty(endpointsAbs)) ?? "";
  const appsettingsSrc = (await readOrEmpty(appsettingsAbs)) ?? "";

  if (!endpointsSrc) {
    throw new Error(
      "Constants/ApiEndpoints.cs is missing — re-scaffold the project (the file is required for API solutions)",
    );
  }

  const newEndpoints = upsertEndpointConstant(
    endpointsSrc,
    spec.endpointName,
    spec.endpointPath,
    spec.endpointSection ?? null,
  );
  const newAppsettings = mergeAppSettings(
    appsettingsSrc,
    spec.urlName,
    spec.baseUrl,
  );

  // Resolve the test class name (also used to derive the per-suite
  // assistant file path: APITestingAssistants/{ClassName}APITestingAssistants.cs).
  let testClassName: string;
  let testClassAbs: string;
  let testClassContent: string;
  let testClassCreated: boolean;
  if (spec.testClass.mode === "new") {
    ident(spec.testClass.className, "Test class name");
    testClassName = spec.testClass.className;
    testClassAbs = path.join(testsDir, "Tests", `${testClassName}.cs`);
    if ((await readOrEmpty(testClassAbs)) !== null) {
      throw new Error(
        `Test class file already exists: Tests/${testClassName}.cs — pick a different class name`,
      );
    }
    testClassContent = renderNewTestClass(spec, project.namespace);
    testClassCreated = true;
  } else {
    const rel = spec.testClass.path.replace(/\\/g, "/");
    if (rel.includes("..") || path.isAbsolute(rel)) {
      throw new Error(`Unsafe test class path: ${rel}`);
    }
    testClassAbs = path.join(testsDir, rel);
    const existing = await readOrEmpty(testClassAbs);
    if (existing === null) {
      throw new Error(`Test class file not found: ${rel}`);
    }
    testClassName = path.basename(rel, ".cs");
    testClassContent = insertFactIntoExistingClass(existing, spec, project.namespace);
    testClassCreated = false;
  }

  // Per-suite Constants/{Suite}Constants.cs is created (empty class) on
  // first build for a suite and left untouched on subsequent builds. Per-
  // suite TestCategories/{Suite}TestCategories.cs is upserted from the
  // recording metadata (idempotent — re-recording the same constant
  // doesn't duplicate it).
  const suiteConstantsAbs = path.join(
    testsDir,
    "Constants",
    `${apiSuiteConstantsClassName(testClassName)}.cs`,
  );
  const suiteConstantsExisting = await readOrEmpty(suiteConstantsAbs);
  const suiteConstantsContent =
    suiteConstantsExisting ??
    renderApiSuiteConstantsFile(project.namespace, testClassName);
  const suiteConstantsCreated = suiteConstantsExisting === null;

  let suiteCategoriesPlan: BuildApiTestPlanFile | null = null;
  if (
    spec.metadata?.categoryConstantName &&
    spec.metadata?.categoryValue !== null &&
    spec.metadata?.categoryValue !== undefined
  ) {
    const catAbs = path.join(
      testsDir,
      "TestCategories",
      `${apiSuiteTestCategoriesClassName(testClassName)}.cs`,
    );
    const catExisting = await readOrEmpty(catAbs);
    const catContent = upsertApiTestCategoryConstant(
      project.namespace,
      testClassName,
      spec.metadata.categoryConstantName,
      `${spec.metadata.categoryValue}`,
      catExisting,
    );
    suiteCategoriesPlan = {
      absPath: catAbs,
      relPath: relPosix(project.rootPath, catAbs),
      content: catContent,
      created: catExisting === null,
    };
  }

  const assistantClassName = assistantClassNameFor(testClassName);
  const assistantAbs = path.join(
    testsDir,
    "APITestingAssistants",
    `${assistantClassName}.cs`,
  );
  const existingAssistantSrc = await readOrEmpty(assistantAbs);
  let newAssistantContent: string;
  let assistantCreated: boolean;
  if (existingAssistantSrc === null) {
    newAssistantContent = renderNewAssistantFile(
      spec,
      project.namespace,
      testClassName,
    );
    assistantCreated = true;
  } else {
    newAssistantContent = upsertHelperMethod(
      existingAssistantSrc,
      spec,
      project.namespace,
      assistantClassName,
    );
    assistantCreated = false;
  }

  const files: BuildApiTestPlanFile[] = [
    {
      absPath: endpointsAbs,
      relPath: relPosix(project.rootPath, endpointsAbs),
      content: newEndpoints,
      created: false,
    },
    {
      absPath: assistantAbs,
      relPath: relPosix(project.rootPath, assistantAbs),
      content: newAssistantContent,
      created: assistantCreated,
    },
    {
      absPath: testClassAbs,
      relPath: relPosix(project.rootPath, testClassAbs),
      content: testClassContent,
      created: testClassCreated,
    },
    {
      absPath: appsettingsAbs,
      relPath: relPosix(project.rootPath, appsettingsAbs),
      content: newAppsettings,
      created: false,
    },
    {
      absPath: suiteConstantsAbs,
      relPath: relPosix(project.rootPath, suiteConstantsAbs),
      content: suiteConstantsContent,
      created: suiteConstantsCreated,
    },
  ];
  if (suiteCategoriesPlan) files.push(suiteCategoriesPlan);
  return { files };
}

/**
 * Atomically commit a planned build: every file is written through a
 * `.tmp` sibling and renamed in place; if any step fails, partial writes
 * are rolled back to their pre-build content. The Tests/ subdirectory is
 * created if needed.
 */
export async function commitApiTestPlan(
  plan: BuildApiTestPlan,
): Promise<void> {
  const backups = new Map<string, string | null>();
  try {
    for (const f of plan.files) {
      const prev = await readOrEmpty(f.absPath);
      backups.set(f.absPath, prev);
      await fs.mkdir(path.dirname(f.absPath), { recursive: true });
      const tmp = `${f.absPath}.tmp`;
      await fs.writeFile(tmp, f.content);
      await fs.rename(tmp, f.absPath);
    }
  } catch (err) {
    for (const [absPath, prev] of backups) {
      try {
        if (prev === null) {
          await fs.unlink(absPath).catch(() => {});
        } else {
          await fs.writeFile(absPath, prev);
        }
      } catch {
        // best-effort rollback
      }
    }
    throw err;
  }
}

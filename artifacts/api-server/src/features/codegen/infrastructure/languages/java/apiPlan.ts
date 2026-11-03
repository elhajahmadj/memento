// The main `planApiTestBuildJava` orchestrator: computes the four (or
// five) file writes for one Build Test invocation, without writing to disk.
import path from "node:path";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import {
  javaApiBasePackage,
  javaApiHelperModule,
  javaApiTestsModule,
} from "@/features/projects/infrastructure/apiJavaScaffolder";
import {
  mergeAppSettings,
  type BuildApiTestSpec,
  type BuildApiTestPlan,
  type BuildApiTestPlanFile,
  type ProjectLike,
} from "@/features/codegen/infrastructure/apiCsharpCodegen";
import {
  HTTP_VERBS,
  apiSuiteTestCategoriesClassName,
  assistantClassNameForJava,
  ident,
  readOrEmpty,
  relPosix,
} from "./apiShared";
import { upsertEndpointConstantJava } from "./apiEndpoints";
import { renderNewAssistantFileJava, upsertHelperMethodJava } from "./apiAssistant";
import {
  renderNewApiTestCategoriesFileJava,
  upsertApiTestCategoryConstantJava,
} from "./apiTestCategories";
import { insertTestIntoExistingClassJava, renderNewTestClassJava } from "./apiTestClass";

/**
 * Plan the four file writes for a Java Build Test invocation, *without*
 * writing to disk. Mirrors the C# `planApiTestBuild` shape so the route
 * adapter can stay uniform across languages.
 */
export async function planApiTestBuildJava(
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
    javaApiHelperModule(project.solutionName),
  );
  const testsDir = safeJoin(
    project.rootPath,
    javaApiTestsModule(project.solutionName),
  );
  const basePkg = javaApiBasePackage(project.solutionName);
  const pkgPath = basePkg.replace(/\./g, "/");

  const endpointsAbs = path.join(
    helperDir,
    `src/main/java/${pkgPath}/constants/ApiEndpoints.java`.replace(/\//g, path.sep),
  );
  const appsettingsAbs = path.join(
    testsDir,
    "src/test/resources/appsettings.json".replace(/\//g, path.sep),
  );

  const endpointsSrc = (await readOrEmpty(endpointsAbs)) ?? "";
  const appsettingsSrc = (await readOrEmpty(appsettingsAbs)) ?? "";

  if (!endpointsSrc) {
    throw new Error(
      "constants/ApiEndpoints.java is missing — re-scaffold the project (the file is required for API solutions)",
    );
  }

  const newEndpoints = upsertEndpointConstantJava(
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

  let testClassName: string;
  let testClassAbs: string;
  let testClassContent: string;
  let testClassCreated: boolean;
  if (spec.testClass.mode === "new") {
    ident(spec.testClass.className, "Test class name");
    testClassName = spec.testClass.className;
    testClassAbs = path.join(
      testsDir,
      `src/test/java/${pkgPath}/tests/tests/${testClassName}.java`.replace(
        /\//g,
        path.sep,
      ),
    );
    if ((await readOrEmpty(testClassAbs)) !== null) {
      throw new Error(
        `Test class file already exists: ${relPosix(project.rootPath, testClassAbs)} — pick a different class name`,
      );
    }
    testClassContent = renderNewTestClassJava(spec, basePkg);
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
    testClassName = path.basename(rel, ".java");
    testClassContent = insertTestIntoExistingClassJava(existing, spec);
    testClassCreated = false;
  }

  const assistantClass = assistantClassNameForJava(testClassName);
  const assistantAbs = path.join(
    testsDir,
    `src/test/java/${pkgPath}/tests/apitestingassistants/${assistantClass}.java`.replace(
      /\//g,
      path.sep,
    ),
  );
  const existingAssistantSrc = await readOrEmpty(assistantAbs);
  let newAssistantContent: string;
  let assistantCreated: boolean;
  if (existingAssistantSrc === null) {
    newAssistantContent = renderNewAssistantFileJava(
      spec,
      basePkg,
      testClassName,
    );
    assistantCreated = true;
  } else {
    newAssistantContent = upsertHelperMethodJava(
      existingAssistantSrc,
      spec,
      basePkg,
      assistantClass,
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
  ];

  // Per-suite `<Suite>TestCategories.java` — emitted only when the
  // recorder picked both fields. Idempotent: if the file already exists
  // we replace the matching constant in place; otherwise we render a
  // fresh single-constant file. Lives at
  // `<basePkg>/tests/testcategories/<Suite>TestCategories.java` (sibling
  // of the `tests/` and `apitestingassistants/` subpackages).
  const planMeta = spec.metadata ?? undefined;
  if (planMeta?.categoryConstantName && planMeta.categoryValue) {
    const categoriesClass = apiSuiteTestCategoriesClassName(testClassName);
    const categoriesAbs = path.join(
      testsDir,
      `src/test/java/${pkgPath}/tests/testcategories/${categoriesClass}.java`.replace(
        /\//g,
        path.sep,
      ),
    );
    const existingCategoriesSrc = await readOrEmpty(categoriesAbs);
    let categoriesContent: string;
    let categoriesCreated: boolean;
    if (existingCategoriesSrc === null) {
      categoriesContent = renderNewApiTestCategoriesFileJava(
        basePkg,
        testClassName,
        planMeta.categoryConstantName,
        planMeta.categoryValue,
      );
      categoriesCreated = true;
    } else {
      categoriesContent = upsertApiTestCategoryConstantJava(
        existingCategoriesSrc,
        planMeta.categoryConstantName,
        planMeta.categoryValue,
      );
      categoriesCreated = false;
    }
    files.push({
      absPath: categoriesAbs,
      relPath: relPosix(project.rootPath, categoriesAbs),
      content: categoriesContent,
      created: categoriesCreated,
    });
  }

  return { files };
}

import path from "node:path";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import {
  NODEJS_API_HELPER_DIR,
  NODEJS_API_TESTS_DIR,
} from "@/features/projects/infrastructure/apiNodejsScaffolder";
import {
  mergeAppSettings,
  type BuildApiTestPlan,
  type BuildApiTestPlanFile,
  type BuildApiTestSpec,
  type ProjectLike,
} from "@/features/codegen/infrastructure/apiCsharpCodegen";
import {
  assistantClassNameFor,
  assistantFileNameFor,
  ident,
  kebabCase,
  pascalCase,
  readOrEmpty,
  relPosix,
  testFileNameFor,
} from "./naming";
import { upsertEndpointConstant } from "./endpoints";
import { renderNewAssistantFile, upsertHelperMethod } from "./assistantFile";
import { insertItIntoExistingClass, renderNewTestClass } from "./testClass";
import { renderCategoriesFile } from "./categories";

const HTTP_VERBS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

/**
 * Plan the four file writes for a Build Test invocation against a Node.js
 * API project. Mirrors the C# adapter — pure (no writes after the initial
 * reads) so the route can commit atomically through `commitApiTestPlan`.
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

  const helperDir = safeJoin(project.rootPath, NODEJS_API_HELPER_DIR);
  const testsDir = safeJoin(project.rootPath, NODEJS_API_TESTS_DIR);

  const endpointsAbs = path.join(helperDir, "constants", "api-endpoints.ts");
  const appsettingsAbs = path.join(testsDir, "appsettings.json");

  const endpointsSrc = await readOrEmpty(endpointsAbs);
  const appsettingsSrc = (await readOrEmpty(appsettingsAbs)) ?? "";
  if (endpointsSrc === null) {
    throw new Error(
      "src/automation-api/constants/api-endpoints.ts is missing — re-scaffold the project (the file is required for Node.js API solutions)",
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

  let testClassName: string;
  let testClassAbs: string;
  let testClassContent: string;
  let testClassCreated: boolean;
  if (spec.testClass.mode === "new") {
    ident(spec.testClass.className, "Test class name");
    testClassName = spec.testClass.className;
    testClassAbs = path.join(testsDir, "tests", testFileNameFor(testClassName));
    if ((await readOrEmpty(testClassAbs)) !== null) {
      throw new Error(
        `Test file already exists: tests/tests/${testFileNameFor(testClassName)} — pick a different class name`,
      );
    }
    testClassContent = renderNewTestClass(spec, testClassName);
    testClassCreated = true;
  } else {
    const rel = spec.testClass.path.replace(/\\/g, "/");
    if (rel.includes("..") || path.isAbsolute(rel)) {
      throw new Error(`Unsafe test class path: ${rel}`);
    }
    testClassAbs = path.join(testsDir, rel);
    const existing = await readOrEmpty(testClassAbs);
    if (existing === null) {
      throw new Error(`Test file not found: ${rel}`);
    }
    const base = path.basename(rel, ".spec.ts");
    testClassName = pascalCase(base);
    testClassContent = insertItIntoExistingClass(existing, spec, testClassName);
    testClassCreated = false;
  }

  const assistantClassName = assistantClassNameFor(testClassName);
  const assistantAbs = path.join(
    testsDir,
    "api-testing-assistants",
    assistantFileNameFor(testClassName),
  );
  const existingAssistantSrc = await readOrEmpty(assistantAbs);
  let newAssistantContent: string;
  let assistantCreated: boolean;
  if (existingAssistantSrc === null) {
    newAssistantContent = renderNewAssistantFile(spec, testClassName);
    assistantCreated = true;
  } else {
    newAssistantContent = upsertHelperMethod(
      existingAssistantSrc,
      spec,
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
  ];
  const catName = spec.metadata?.categoryConstantName ?? null;
  const catValue = spec.metadata?.categoryValue ?? null;
  if (
    typeof catName === "string" &&
    catName.length > 0 &&
    typeof catValue === "string" &&
    catValue.length > 0
  ) {
    const categoriesAbs = path.join(
      testsDir,
      "test-categories",
      `${kebabCase(testClassName)}.categories.ts`,
    );
    const existingCatSrc = await readOrEmpty(categoriesAbs);
    files.push({
      absPath: categoriesAbs,
      relPath: relPosix(project.rootPath, categoriesAbs),
      content: renderCategoriesFile(
        testClassName,
        existingCatSrc,
        catName,
        catValue,
      ),
      created: existingCatSrc === null,
    });
  }
  return { files };
}

import fs from "node:fs/promises";
import path from "node:path";
import {
  API_PYTHON_HELPER_DIR,
  API_PYTHON_TESTS_DIR,
} from "@/features/projects/infrastructure/apiPythonScaffolder";
import {
  mergeAppSettings,
  type BuildApiTestPlan,
  type BuildApiTestPlanFile,
  type BuildApiTestSpec,
  type ProjectLike,
} from "@/features/codegen/infrastructure/apiCsharpCodegen";
import {
  categoriesClassNameForSuite,
  categoriesRelPathForSuite,
} from "@/features/codegen/infrastructure/pythonCodegen";
import { readOrEmpty, relPosix } from "./fileUtils";
import {
  HTTP_VERBS,
  assistantClassNameFor,
  ident,
  snakeCase,
} from "./naming";
import { upsertEndpointConstant } from "./endpointConstants";
import { renderNewAssistantFile, upsertHelperMethod } from "./helperMethod";
import {
  insertMethodIntoExistingClass,
  renderNewTestClass,
} from "./testClass";

// ─── plan / commit ──────────────────────────────────────────────────────

const TEST_CLASS_RE = /^[ \t]*class\s+(\w+)\s*[:(]/m;

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

  const helperDir = path.join(project.rootPath, API_PYTHON_HELPER_DIR);
  const testsDir = path.join(project.rootPath, API_PYTHON_TESTS_DIR);

  const endpointsAbs = path.join(helperDir, "constants", "api_endpoints.py");
  const appsettingsAbs = path.join(testsDir, "appsettings.json");

  const endpointsSrc = await readOrEmpty(endpointsAbs);
  const appsettingsSrc = (await readOrEmpty(appsettingsAbs)) ?? "";
  if (endpointsSrc === null) {
    throw new Error(
      "automation_api/constants/api_endpoints.py is missing — re-scaffold the project (the file is required for API solutions)",
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
    testClassAbs = path.join(testsDir, "tests", `test_${testClassName}.py`);
    if ((await readOrEmpty(testClassAbs)) !== null) {
      throw new Error(
        `Test class file already exists: tests/test_${testClassName}.py — pick a different class name`,
      );
    }
    testClassContent = renderNewTestClass(spec);
    testClassCreated = true;
  } else {
    const rel = spec.testClass.path.replace(/\\/g, "/");
    if (rel.includes("..") || path.isAbsolute(rel)) {
      throw new Error(`Unsafe test class path: ${rel}`);
    }
    testClassAbs = path.join(project.rootPath, rel);
    const existing = await readOrEmpty(testClassAbs);
    if (existing === null) {
      throw new Error(`Test class file not found: ${rel}`);
    }
    const m = TEST_CLASS_RE.exec(existing);
    if (!m) {
      throw new Error(
        `Target test class file does not contain a class declaration: ${rel}`,
      );
    }
    testClassName = m[1];
    testClassContent = insertMethodIntoExistingClass(existing, spec);
    testClassCreated = false;
  }

  const assistantClassName = assistantClassNameFor(testClassName);
  const assistantAbs = path.join(
    testsDir,
    "api_testing_assistants",
    `${snakeCase(assistantClassName)}.py`,
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

  // When the spec carries a category, idempotently upsert the
  // `{Suite}Categories` constant into
  // `tests/test_categories/{snake}_categories.py`. The file is created
  // on first use; subsequent writes parse-merge so other constants for
  // the same suite are preserved across Build Test invocations.
  if (spec.metadata?.categoryConstantName && spec.metadata?.categoryValue) {
    const categoriesRel = path.join(
      API_PYTHON_TESTS_DIR,
      categoriesRelPathForSuite(testClassName),
    );
    const categoriesAbs = path.join(project.rootPath, categoriesRel);
    const existingCategories = (await readOrEmpty(categoriesAbs)) ?? "";
    const className = categoriesClassNameForSuite(testClassName);
    const entries = new Map<string, string>();
    if (existingCategories) {
      const re =
        /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*str\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(existingCategories)) !== null) {
        entries.set(
          m[1]!,
          m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
        );
      }
    }
    entries.set(spec.metadata?.categoryConstantName, spec.metadata?.categoryValue);
    const sorted = Array.from(entries.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    const escapePy = (v: string): string =>
      v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const body =
      sorted
        .map(([k, v]) => `    ${k}: str = "${escapePy(v)}"`)
        .join("\n") || "    pass";
    const categoriesContent = `"""Test categories for the ${testClassName} suite."""


class ${className}:
${body}
`;
    files.push({
      absPath: categoriesAbs,
      relPath: relPosix(project.rootPath, categoriesAbs),
      content: categoriesContent,
      created: existingCategories === "",
    });
  }

  return { files };
}

/**
 * Atomically commit a planned build. Mirrors `commitApiTestPlan` from the
 * C# adapter (kept independent so the two languages don't share an
 * import cycle through the registry).
 */
export async function commitApiTestPlan(plan: BuildApiTestPlan): Promise<void> {
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

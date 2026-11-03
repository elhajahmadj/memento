import path from "node:path";
import fs from "node:fs/promises";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import type {
  AiRunReport,
  AiTestKind,
} from "@/features/ai-agent/domain/types";
import { emitCsharp } from "./csharpRecorderEmitter";
import { emitPython } from "./pythonRecorderEmitter";
import { emitNode } from "./nodejsRecorderEmitter";
import { emitJava } from "./javaRecorderEmitter";

/**
 * Materialize a generated AI run into the project tree as actual test
 * files. Returns the list of project-relative POSIX paths written.
 *
 * All four languages route through their own recorder-style emitter
 * (`{lang}RecorderEmitter.ts`) so generated AI tests plug into the
 * existing Memento test architecture for each language instead of
 * dumping standalone files into a throw-away "AI" namespace:
 *
 *   csharp → {Project}.Tests/Tests/{Suite}Tests.cs (+ PageObjects/Selectors/Constants)
 *   python → tests/test_{snake}.py (+ pages/, tests/constants/)
 *   nodejs → tests/{kebab}.spec.ts (+ pages/, tests/constants/)
 *   java   → {Project}-tests/src/test/java/{pkg}/tests/{Pascal}Tests.java
 *           (+ pages/, constants/, src/test/resources/application.properties)
 *
 * Each emitter is also kind-aware (playwright / api / unit) and uses a
 * sibling-file or partial-class strategy so re-runs never clobber
 * hand-written code.
 */
export async function materializeRun(opts: {
  projectName: string;
  runId: string;
  language: "csharp" | "python" | "nodejs" | "java";
  kind: AiTestKind;
  report: AiRunReport;
  targetMode?: "new_suite" | "add_method";
  existingSuiteFile?: string | null;
  /**
   * Verbatim plan text from the Build with AI dialog. Threaded into
   * the C# emitter so it can persist the user's setup intent into a
   * hidden `{ClassName}Setup` sidecar when the run targets a
   * `[SetUp]` / `[OneTimeSetUp]` hook.
   */
  planText?: string;
}): Promise<string[]> {
  const projectRoot = path.join(
    recorderConfig.workspaceDir,
    opts.projectName,
  );
  // Verify the project root exists before writing — refuse to scaffold
  // a fresh tree from scratch.
  try {
    const st = await fs.stat(projectRoot);
    if (!st.isDirectory()) {
      throw new Error(`Project root is not a directory: ${projectRoot}`);
    }
  } catch (err) {
    throw new Error(
      `Project '${opts.projectName}' has no on-disk root at ${projectRoot}: ${(err as Error).message}`,
    );
  }

  const targetMode = opts.targetMode ?? "new_suite";
  const existingSuiteFile = opts.existingSuiteFile ?? null;

  if (opts.language === "csharp") {
    return emitCsharp({
      projectRoot,
      projectName: opts.projectName,
      runId: opts.runId,
      report: opts.report,
      targetMode,
      existingSuiteFile,
      planText: opts.planText,
    });
  }
  if (opts.language === "python") {
    return emitPython({
      projectRoot,
      runId: opts.runId,
      report: opts.report,
      targetMode,
      existingSuiteFile,
      planText: opts.planText,
    });
  }
  if (opts.language === "nodejs") {
    return emitNode({
      projectRoot,
      runId: opts.runId,
      report: opts.report,
      targetMode,
      existingSuiteFile,
      planText: opts.planText,
    });
  }
  return emitJava({
    projectRoot,
    projectName: opts.projectName,
    runId: opts.runId,
    report: opts.report,
    targetMode,
    existingSuiteFile,
    planText: opts.planText,
  });
}

import type { AiRunReport, AiRunStep } from "@/features/ai-agent/domain/types";

export interface JavaEmitOptions {
  projectRoot: string;
  projectName: string;
  runId: string;
  report: AiRunReport;
  targetMode: "new_suite" | "add_method";
  /**
   * Project-relative POSIX path to the user-picked existing suite file
   * (e.g. `Demo-tests/src/test/java/demo/tests/LoginTests.java`).
   * Required in `add_method` mode — the emitter parses its declared
   * class + package and appends the new `@Test` method into that
   * file in place, instead of dropping a sibling
   * `{Pascal}Tests_AiMethod_*.java` next to it.
   */
  existingSuiteFile?: string | null | undefined;
  /**
   * Verbatim plan text from the Build with AI dialog. Persisted into
   * a hidden `{ClassName}.setup` sidecar when the run targets a
   * `@BeforeEach` / `@BeforeAll` hook so later `add_method` runs can
   * prepend the prior setup intent to the LLM context.
   */
  planText?: string | undefined;
}

export interface JavaTarget {
  testsModuleDir: string; // absolute
  testsModuleRel: string; // project-root-relative POSIX
  pkg: string; // e.g. "demo"
}

export interface JavaMethod {
  name: string;
  param: string | null;
  body: string[];
}

export interface JavaTestArgs {
  runId: string;
  pkg: string;
  className: string;
  suitePascal: string;
  kind: "playwright" | "api" | "unit";
  steps: AiRunStep[];
  report: AiRunReport;
  methodName: string;
  targetMethod: "test" | "beforeEach" | "oneTimeSetUp";
  ignore: boolean;
  ignoreReason: string | null;
}

export interface JavaMethodChunk {
  imports: string[];
  method: string;
}

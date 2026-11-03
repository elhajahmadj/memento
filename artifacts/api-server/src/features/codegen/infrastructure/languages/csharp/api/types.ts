/**
 * Shared types for the C# "Build API Test" codegen surface. Split out of
 * the original `apiCsharpCodegen.ts` monolith so per-section emitters
 * stay small and focused (task #36).
 */
export const CSHARP_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const HTTP_VERBS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;
export type HttpVerb = (typeof HTTP_VERBS)[number];

export type BuildInto = "testMethod" | "oneTimeSetup" | "perTestSetup";

export interface ApiTestParameter {
  name: string;
  type: string;
}

export interface MultipartField {
  name: string;
  valueExpression: string;
}

export interface DefaultHeader {
  name: string;
  value: string;
}

export interface BuildApiTestSpec {
  baseUrl: string;
  urlName: string;
  endpointName: string;
  endpointSection?: string | null;
  endpointPath: string;
  buildInto: BuildInto;
  testMethodName: string;
  testClass:
    | { mode: "new"; className: string }
    | { mode: "existing"; path: string };
  helperMethodName: string;
  parameters: ApiTestParameter[];
  httpMethod: HttpVerb;
  useAccessToken: boolean;
  multipartFields: MultipartField[];
  defaultHeaders: DefaultHeader[];
  /**
   * Optional per-recording metadata (Ignore + Test Categories). For the
   * xUnit API codegen (task #194), when `metadata.ignoreReason` is non-empty
   * the emitted `[Fact]` becomes `[Fact(Skip="…")]`. When both
   * `categoryConstantName` and `categoryValue` are non-empty a
   * `[Trait("Category", {Suite}TestCategories.{Const})]` attribute is
   * prepended above the `[Fact]`, an idempotent constant is upserted into
   * `{TestProj}/TestCategories/{Suite}TestCategories.cs`, and the test file
   * gains a `using {ns}.Automation.API.Tests.TestCategories;`. The suite stem
   * is derived from the test class name (stripping a trailing `Tests` or
   * `TestSuite` suffix). Also read by the Python API codegen
   * (`apiPythonCodegen.ts`, task #195) — when `ignoreReason` is set it
   * emits `@pytest.mark.skip(reason=...)` and when both category fields
   * are set it emits `@pytest.mark.{value}` plus an upserted
   * `test_categories/{snake}_categories.py` file — by the Node.js
   * Vitest codegen (task #196) to decorate the generated `it(...)` block,
   * and by the Java API codegen (task #197) to emit `@Disabled("...")` +
   * `@Tag(<Suite>TestCategories.NAME)` and upsert the per-suite
   * `<Suite>TestCategories.java` file. Other languages ignore the field
   * until their own tasks land. Adapter-internal type; not part of any
   * OpenAPI contract.
   */
  metadata?: {
    ignoreReason?: string | null;
    categoryConstantName?: string | null;
    categoryValue?: string | null;
  } | null;
}

export interface BuildApiTestPlanFile {
  /** Absolute path to the file. */
  absPath: string;
  /** Project-relative POSIX path. */
  relPath: string;
  /** Final content to write. */
  content: string;
  /** True when the path didn't exist before. */
  created: boolean;
}

export interface BuildApiTestPlan {
  files: BuildApiTestPlanFile[];
}

export interface ProjectLike {
  rootPath: string;
  solutionName: string;
  namespace: string;
}

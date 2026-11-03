/**
 * Cross-language codegen domain types.
 *
 * These types describe the data the per-language emitters consume and
 * produce. They are intentionally pure (no IO, no language-specific
 * runtime imports) so the language-agnostic orchestrator
 * (`application/useCases/generateTest.ts`) and the per-language
 * adapters can both depend on them without one having to import the
 * other.
 *
 * Each per-language emitter (`csharpCodegen.ts`, `pythonCodegen.ts`,
 * `nodejsCodegen.ts`, `javaCodegen.ts`) re-exports these types under
 * the names they have historically used, so existing call sites need
 * not change their imports.
 */

export type AssertionKind =
  | "element-has-text"
  | "url-contains"
  | "url-equals"
  | "element-visible"
  | "element-hidden"
  | "element-count-equals"
  | "attribute-equals"
  | "value-equals"
  | "response-status"
  | "api-status"
  | "accessibility"
  | "visual-baseline";

/**
 * HTTP method for `apiAssertion` and `routeMock` recorded actions.
 * Constrained to the verbs Playwright's `request` and `page.route()`
 * helpers actually need; PATCH is included because REST-y APIs use it
 * frequently.
 */
export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Wait-action discriminator (task 29 — Tier 2). `selector` waits for a
 * Playwright locator to become visible; `networkidle` parks until there
 * are no in-flight requests for 500 ms; `timeout` is a hard sleep.
 */
export type WaitKind = "selector" | "networkidle" | "timeout";

export interface RecordedAction {
  type:
    | "click"
    | "fill"
    | "navigate"
    | "select"
    | "check"
    | "assert"
    | "routeMock"
    | "apiAssertion"
    | "wait";
  selector?: string | undefined;
  selectorStrategy?:
    | "data-testid"
    | "id"
    | "xpath"
    | "js-path"
    | "aria-label"
    | "css"
    | undefined;
  value?: string | undefined;
  url?: string | undefined;
  assertKind?: AssertionKind | undefined;
  assertText?: string | undefined;
  assertUrl?: string | undefined;
  assertCount?: number | undefined;
  assertAttribute?: string | undefined;
  assertAttrValue?: string | undefined;
  assertValue?: string | undefined;
  assertStatusCode?: number | undefined;
  apiMethod?: ApiMethod | undefined;
  apiUrl?: string | undefined;
  apiExpectedStatus?: number | undefined;
  apiRequestBody?: string | undefined;
  apiExpectedJson?: string | undefined;
  mockStatus?: number | undefined;
  mockBody?: string | undefined;
  axeImpactLevel?: "minor" | "moderate" | "serious" | "critical" | undefined;
  visualName?: string | undefined;
  visualThreshold?: number | undefined;
  waitKind?: WaitKind | undefined;
  waitSelector?: string | undefined;
  waitMs?: number | undefined;
  editable?: {
    kind: "input" | "textarea" | "contenteditable";
    label: string;
  } | undefined;
  methodName?: string | undefined;
  deleted?: boolean | undefined;
  macroName?: string | undefined;
}

export type HookKind = "beforeEach" | "oneTimeSetup";

export interface ReplaceHookBodyResult {
  /**
   * Relative path to the `.bak` file that captured the previous (non-default)
   * hook body, or null when there was nothing worth preserving (the hook was
   * absent or held only the default stub).
   */
  backupPath: string | null;
}

export interface AddTestMethodResult {
  /** The method name actually written to the file (may differ from the
   *  requested name when a collision was auto-disambiguated). */
  methodName: string;
  /** True when the requested name already existed and was suffixed. */
  renamed: boolean;
  /** The originally requested name, preserved for messaging. */
  requestedName: string;
}

export interface AddTestMethodOptions {
  overwrite?: boolean | undefined;
  suiteName?: string | undefined;
  metadata?: {
    ignoreReason?: string | null | undefined;
    categoryConstantName?: string | null | undefined;
    categoryValue?: string | null | undefined;
  } | null | undefined;
}

export interface SuiteFiles {
  selectorsPath: string;
  interfacePath: string;
  actionsPath: string;
}

export interface SuiteGenerationResult extends SuiteFiles {
  /** Method name per recorded action, in input order, for the test body. */
  methodNames: Map<RecordedAction, string>;
  /** True if the actions class takes a value argument, by method name. */
  takesValueByMethod: Map<string, boolean>;
}

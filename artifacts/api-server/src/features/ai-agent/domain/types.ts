/**
 * Shared domain types for the AI Agent feature. Kept dependency-free
 * so they can be referenced from infrastructure, presentation, and
 * tests without dragging the express/db layers into pure logic.
 */

export type AiProvider =
  | "anthropic"
  | "openai"
  | "gemini"
  | "openrouter"
  | "azure_openai"
  | "groq"
  | "deepseek"
  | "mistral";

/**
 * Provider-specific extra configuration stored alongside the API key.
 * - Azure OpenAI requires `endpointUrl` + `apiVersion`.
 * - OpenRouter optionally accepts `refererUrl` + `appName` headers.
 * - All providers may carry a `model` override (free-form); when null
 *   the adapter uses the per-provider default.
 */
export interface AiProviderExtras {
  endpointUrl: string | null;
  apiVersion: string | null;
  refererUrl: string | null;
  appName: string | null;
  model: string | null;
}

// `AI_PROVIDERS`, `DEFAULT_MODELS`, and `DEFAULT_AZURE_API_VERSION`
// live in `../infrastructure/providers` — derived from the per-provider
// definition files. Import them from there.

export type AiTestKind = "playwright" | "api" | "unit";

export type AiRunStatus = "pending" | "running" | "succeeded" | "failed";

export type CatalogSource = "user" | "ai";

/**
 * One interpreted, executed step in a run report. The shape mirrors
 * section 6 of the AI Test Runner concept doc; the per-kind call list
 * lives under `playwrightCalls` / `httpCalls` / `unitCalls` so
 * downstream materializers can fan out cleanly per language.
 */
export interface AiRunStep {
  index: number;
  input: string;
  /** Resolved method (catalog match or AI-created). */
  method: {
    name: string;
    source: "existing" | "ai-created";
    matchType: "exact" | "semantic" | "none";
    confidence?: number;
    params?: Record<string, unknown>;
  };
  playwrightCalls?: Array<{
    method: string;
    selector?: string;
    rawSelector?: string;
    value?: string;
    args?: unknown[];
  }>;
  httpCalls?: Array<{
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    status?: number;
    responseBody?: unknown;
  }>;
  unitCalls?: Array<{
    function: string;
    args: unknown[];
    expected?: unknown;
    actual?: unknown;
  }>;
  inputs?: Array<{ field: string; value: string }>;
  result: "passed" | "failed" | "skipped";
  durationMs?: number;
  errorMessage?: string;
}

export interface AiRunCatalogDeltas {
  newMethods: Array<{
    name: string;
    params?: string[];
    createdInRun: string;
  }>;
  newSelectors: Array<{
    name: string;
    selector: string;
    createdInRun: string;
  }>;
  newCategories: string[];
}

export type AiTargetMethod = "test" | "beforeEach" | "oneTimeSetUp";

export interface AiRunReport {
  runId: string;
  kind: AiTestKind;
  suiteName: string;
  status: AiRunStatus;
  categories: string[];
  startedAt: string;
  finishedAt?: string;
  steps: AiRunStep[];
  catalogDeltas: AiRunCatalogDeltas;
  /**
   * Which method the AI run targeted. Defaults to `"test"` for
   * runs created before this field existed.
   */
  targetMethod?: AiTargetMethod;
  /** Whether the materialized test should be marked as ignored. */
  ignore?: boolean;
  /** Reason text used when `ignore` is true. */
  ignoreReason?: string | null;
  /**
   * Method name to use for the generated test, in
   * `Given<X>_When<Y>_Then<Z>` PascalCase. Computed by the runner so
   * every emitter agrees.
   */
  methodName?: string;
  /**
   * Named URL constants derived from each navigate step. Stored on
   * the report so every emitter (C# / Python / Node.js / Java) writes
   * the same identifier into its config file and references it from
   * the generated test.
   *
   * Each entry pairs the raw URL with the PascalCase identifier that
   * ends in `BaseUrl`. The first entry is the suite's primary URL.
   */
  urlNames?: Array<{ url: string; name: string }>;
  /**
   * Combined plain-text setup context the runner prepended to the
   * LLM prompt for `add_method` runs against an existing test suite.
   * See the `AiAgentRunDetail.report.setupContextText` field in the
   * OpenAPI spec for the full contract.
   */
  setupContextText?: string | null;
}

export class AiAgentDisabledError extends Error {
  readonly code: "ORG_DISABLED" | "PROJECT_DISABLED" | "NO_API_KEY";
  constructor(code: "ORG_DISABLED" | "PROJECT_DISABLED" | "NO_API_KEY") {
    const messages: Record<typeof code, string> = {
      ORG_DISABLED:
        "AI Agent is disabled for this organization. An admin can enable it under Tools → AI Agent.",
      PROJECT_DISABLED:
        "AI Agent is disabled for this project. An admin can enable it under Tools → AI Agent.",
      NO_API_KEY:
        "No AI provider API key is configured. An admin must add one under Tools → AI Agent before running.",
    };
    super(messages[code]);
    this.name = "AiAgentDisabledError";
    this.code = code;
  }
}

export class AiProviderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AiProviderError";
    this.status = status;
  }
}

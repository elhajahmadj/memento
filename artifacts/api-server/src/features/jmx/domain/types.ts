/**
 * Shared JMX (JMeter) domain types.
 *
 * These contracts are the single point of agreement between the
 * parallel JMX slices: the CDP-based HTTP recorder captures events
 * shaped like `JmxHttpEvent`, the XML emitter consumes them, and the
 * New Project / Workbench UI passes `JmxExportOptions` when asking the
 * server to emit a `.jmx` plan. Keeping them in one module means none
 * of the downstream slices have to take a build dependency on each
 * other.
 *
 * Pure types only — no I/O, no framework imports.
 */

/**
 * Export mode for the JMeter `.jmx` plan emitter.
 *
 *  - `withCreds`     — embed the captured login credentials directly
 *    in the plan (the developer's "just run it" mode).
 *  - `withoutCreds`  — replace credentials with JMeter variables /
 *    `__P()` references so the plan can be checked in / shared.
 */
export type JmxExportMode = "withCreds" | "withoutCreds";

/**
 * One captured HTTP request/response pair from the CDP recorder. The
 * XML emitter walks an ordered list of these to materialize JMeter
 * HTTP samplers, header managers, and assertions.
 */
export interface JmxHttpEvent {
  /** Uppercase HTTP method (GET, POST, ...). */
  method: string;
  /** Absolute request URL as observed on the wire. */
  url: string;
  /** Request headers exactly as sent (header name → value). */
  headers: Record<string, string>;
  /** Request `Content-Type`, or empty string when none was sent. */
  contentType: string;
  /** Request body as UTF-8 text. Empty string when no body was sent. */
  bodyText: string;
  /** Response status code (e.g. 200, 404). */
  statusCode: number;
  /**
   * Response body as UTF-8 text. May be empty when the response had
   * no body or when capture was suppressed (e.g. binary asset,
   * unsupported content-type, redirect on a non-BFF project). When
   * the body exceeds the recorder's size cap it is truncated and
   * suffixed with `BODY_TRUNCATION_MARKER` so downstream consumers can
   * see the truncation rather than silently working from a partial
   * payload.
   */
  responseBody: string;
  /**
   * Verbatim value of the response `Location` header when present
   * (typically on 3xx redirects). Captured on its own field — rather
   * than only inside `headers` on a separate response event — so the
   * OAuth/PKCE/state correlation slice can walk the recorded request
   * chain without having to reconstruct redirect targets.
   * Optional for back-compat with already-persisted recordings.
   */
  locationHeader?: string;
  /** Wall-clock capture time in milliseconds since the epoch. */
  timestamp: number;
}

/**
 * Maximum number of bytes of a response body the JMX recorder will
 * persist on a `JmxHttpEvent`. Larger bodies are truncated to this
 * length and have `BODY_TRUNCATION_MARKER` appended so the captured
 * event row stays bounded and the truncation is observable.
 */
export const MAX_RESPONSE_BODY_BYTES = 256 * 1024;

/** Marker appended to a `responseBody` value that was truncated to fit `MAX_RESPONSE_BODY_BYTES`. */
export const BODY_TRUNCATION_MARKER =
  "\n…[jmx-recorder: response body truncated]…";

/**
 * Knobs the user picks in the New Project / Workbench UI that drive
 * how the `.jmx` plan is emitted.
 */
export interface JmxExportOptions {
  /**
   * `true`  → bake captured credentials straight into the plan.
   * `false` → replace credentials with JMeter variables.
   * Mirrors the `withCreds` / `withoutCreds` mode literal but kept as
   * a boolean for terser call sites.
   */
  embedCredentials: boolean;
  /**
   * When `true`, the emitter wires up a JWT auth flow: it captures
   * the login response, extracts a bearer token (using
   * `tokenJsonPath`), and replays it on every subsequent sampler.
   */
  jwtAuth: boolean;
  /**
   * Base URL the emitted plan should target. Captured request URLs
   * are rewritten relative to this so the plan can be re-pointed at
   * a different environment without editing every sampler.
   */
  baseUrl: string;
  /**
   * Optional path on `baseUrl` that performs login (e.g. `/api/auth`).
   * When set together with `jwtAuth`, the emitter treats this request
   * specially.
   */
  loginPath?: string;
  /**
   * Optional JSONPath into the login response that yields the bearer
   * token (e.g. `$.token` or `$.access_token`). Only consulted when
   * `jwtAuth` is `true`.
   */
  tokenJsonPath?: string;
  /**
   * Optional CSV-driven parameterization mode. When set, the emitter
   * emits a `CSVDataSet` config element so the same plan can drive
   * many parameter combinations.
   */
  csvMode?: "off" | "perRequest" | "global";
  /**
   * When `true`, the project is a Backend-for-Frontend (BFF) and the
   * emitter applies BFF-specific transforms:
   *   - CSRF / double-submit token correlation (hidden form fields
   *     and `XSRF-TOKEN`-style cookies).
   *   - First-class endpoint classification: captured samplers are
   *     grouped under three labeled `GenericController`s — `BFF`,
   *     `IdP`, `Upstream API` — and each sampler name is prefixed
   *     with its class.
   * Non-BFF plans get zero behavioural change — the flat sampler
   * layout is preserved.
   */
  bff?: boolean;
}

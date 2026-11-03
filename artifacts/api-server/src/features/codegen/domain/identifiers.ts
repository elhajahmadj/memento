/**
 * Pure identifier-sanitization helpers shared across every per-language
 * codegen emitter. These have no IO, no FS access, and no language
 * runtime imports — they are safe to call from any layer.
 *
 * The functions here are re-exported from `codegenAdapter.ts` and from
 * the per-language emitter modules so the public surface used by route
 * handlers and the recording service does not change.
 */

/**
 * Uppercase + collapse runs of non-alnum characters to a single `_`.
 * Used to build env-var keys (`buildUrlEnvVarName`) AND to derive the
 * Python/Node/Java `TestConfig.<NAME>` property name from the same
 * urlName so the two identifiers cannot drift.
 */
export function urlSafe(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/**
 * Build the env-var key for a named start URL. Both halves are
 * upper-cased and stripped of non-alphanumeric characters (collapsed
 * runs become a single `_`) so the result is a legal POSIX shell name.
 * The exact format is `<SOLUTION>_URL_<NAME>`.
 *
 * Single source of truth: both the codegen (which emits
 * `process.env["<KEY>"]` / `os.environ["<KEY>"]`) and the recorder
 * (which writes the matching `<KEY>=<value>` to `.env`) call this
 * function for the same `(solutionName, urlName)` pair.
 */
export function buildUrlEnvVarName(
  solutionName: string,
  urlName: string,
): string {
  return `${urlSafe(solutionName)}_URL_${urlSafe(urlName)}`;
}

/**
 * Property name used by the typed URL accessor in Python / Node / Java
 * (e.g. `Login` → `LOGIN`, `LoginUrl` → `LOGINURL`, `Home Page` →
 * `HOME_PAGE`). Mirrors the suffix in `buildUrlEnvVarName` so the
 * recorder can regenerate the per-language `TestConfig` file from
 * nothing but the `<SOLUTION>_URL_*` keys present in `.env`.
 */
export function urlConfigPropertyName(urlName: string): string {
  return urlSafe(urlName);
}

/**
 * Normalize a user-typed C# test-suite class name so the on-disk file
 * and class always end with `TestSuite`. A suite typed as `LoginPage`
 * becomes `LoginPageTestSuite`, while a suite already typed as
 * `LoginPageTestSuite` is left alone (no double-suffix). Whitespace is
 * trimmed first so `"  LoginPage  "` also normalizes cleanly.
 */
export function normalizeCsharpTestSuiteClassName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return trimmed;
  return trimmed.endsWith("TestSuite") ? trimmed : `${trimmed}TestSuite`;
}

/**
 * Append the C# `Async` suffix to a method name when missing. Idempotent
 * — `FooAsync` stays `FooAsync` rather than becoming `FooAsyncAsync`.
 */
export function ensureAsyncSuffix(name: string): string {
  return name.endsWith("Async") ? name : `${name}Async`;
}

/**
 * Map an axe-core severity floor (`minor`/`moderate`/`serious`/`critical`)
 * to the list of impact levels that should count as a violation. Anything
 * at or above the supplied level is included; an unknown or missing level
 * defaults to `serious + critical`.
 */
export function axeAllowedImpacts(level: string | undefined): string[] {
  const ALL = ["minor", "moderate", "serious", "critical"] as const;
  const lvl = (level ?? "serious").toLowerCase();
  const idx = ALL.indexOf(lvl as (typeof ALL)[number]);
  if (idx < 0) return ["serious", "critical"];
  return ALL.slice(idx);
}

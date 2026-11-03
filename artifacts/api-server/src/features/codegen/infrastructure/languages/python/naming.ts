/**
 * Naming, quoting, and per-suite path helpers shared across every
 * Python codegen section. Kept identifier-only (no I/O) so other
 * sections can import freely without picking up unrelated deps.
 */
import type { HookKind } from "@/features/codegen/infrastructure/codegen";

/** Convert `CamelCase` / `mixedCase` → `snake_case`. */
export function toSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/** Convert any string into a legal Python `snake_case` identifier. */
export function toPyIdent(s: string): string {
  const snake = toSnake(s).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!snake) return "x";
  return /^[a-z_]/.test(snake) ? snake : `x_${snake}`;
}

export const PYTHON_HOOK_INFO: Record<HookKind, { method: string }> = {
  beforeEach: { method: "before_each" },
  oneTimeSetup: { method: "one_time_setup" },
};

/** Public alias of `hookMethodName` for Python. */
export function hookMethodNamePython(hook: HookKind): string {
  return PYTHON_HOOK_INFO[hook].method;
}

/** Render a Python double-quoted literal with backslash + quote escaping. */
export function pyQuotedArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Escape a value for inclusion inside a Python double-quoted literal body. */
export function escapePy(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

/** Relative path to a recorded test class file, e.g. `tests/test_login.py`. */
export function testFileRelPath(className: string): string {
  return `tests/test_${toSnake(className)}.py`;
}

export function selectorsFileRelPath(suiteName: string): string {
  return `pages/selectors/${toSnake(suiteName)}_selectors.py`;
}

export function actionsFileRelPath(suiteName: string): string {
  return `pages/actions/${toSnake(suiteName)}_actions.py`;
}

// ---------------------------------------------------------------------------
// Per-suite naming helpers (constants + test categories)
// ---------------------------------------------------------------------------

/**
 * Strip a trailing `TestSuite` / `Tests` / `Test` decoration from a
 * suite name so the per-suite Constants / Categories artifacts are
 * named after the underlying noun:
 *   `Login`            -> `Login`
 *   `LoginTests`       -> `Login`
 *   `CheckoutTestSuite`-> `Checkout`
 *   `UsersTests`       -> `Users`
 * If stripping would leave an empty string, the original name is
 * returned unchanged so we never produce an empty class name.
 */
export function bareSuiteName(suiteName: string): string {
  const stripped = suiteName.replace(/(?:TestSuite|Tests|Test)$/u, "");
  return stripped.length > 0 ? stripped : suiteName;
}

/** Class name written into `constants/{snake}_constants.py`. */
export function constantsClassNameForSuite(suiteName: string): string {
  return `${bareSuiteName(suiteName)}Constants`;
}

/** Class name written into `test_categories/{snake}_categories.py`. */
export function categoriesClassNameForSuite(suiteName: string): string {
  return `${bareSuiteName(suiteName)}Categories`;
}

/** Module path under `constants/`. */
export function constantsRelPathForSuite(suiteName: string): string {
  return `constants/${toSnake(bareSuiteName(suiteName))}_constants.py`;
}

/** Module path under `test_categories/`. */
export function categoriesRelPathForSuite(suiteName: string): string {
  return `test_categories/${toSnake(bareSuiteName(suiteName))}_categories.py`;
}

/** Python dotted-import path for the per-suite constants module. */
export function constantsImportModuleForSuite(suiteName: string): string {
  return `constants.${toSnake(bareSuiteName(suiteName))}_constants`;
}

/** Python dotted-import path for the per-suite categories module. */
export function categoriesImportModuleForSuite(suiteName: string): string {
  return `test_categories.${toSnake(bareSuiteName(suiteName))}_categories`;
}

/**
 * Normalize a freeform category value (e.g. `"smoke-tests"`) into a
 * legal pytest marker identifier. Pytest markers are accessed as
 * attributes on `pytest.mark` so the literal slug must be a valid
 * Python identifier — `-` becomes `_`, leading digits are prefixed.
 */
export function pytestMarkerName(value: string): string {
  let s = value.trim().replace(/[^A-Za-z0-9_]+/g, "_");
  s = s.replace(/^_+|_+$/g, "");
  if (!s) return "category";
  if (/^[0-9]/.test(s)) s = `m_${s}`;
  return s;
}

/** Suggest a non-colliding name by appending numeric suffix (matches C#). */
export function suggestNonCollidingName(
  desired: string,
  used: Set<string>,
): string {
  if (!used.has(desired)) return desired;
  let suffix = 2;
  while (used.has(`${desired}${suffix}`)) suffix++;
  return `${desired}${suffix}`;
}

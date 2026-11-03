/**
 * C# verb-noun-Async naming convention helpers used by both the
 * page-object actions emitter and the live-preview / suggestion paths
 * consumed by the workbench UI.
 */
import type { RecordedAction } from "@/features/codegen/domain/types";
import { pascal } from "./identifiers";

/**
 * The C# verb-noun-Async naming convention: known verb prefixes that the
 * recorder strips off user-entered method names (so the user can type
 * `LoginButton`, `ClickLoginButton`, or `ClickLoginButtonAsync` and we
 * always store the bare noun `LoginButton`).
 */
export const CSHARP_KNOWN_VERBS = ["Click", "Fill", "Check", "Select"] as const;
export const SELECTOR_KEY_SUFFIX = "Selector";
export const ELEMENT_FIELD_SUFFIX = "Element";

/**
 * Map a recorded-action type to the C# verb the page-object Actions class
 * will use as the method-name prefix.
 */
export function csharpVerbForActionType(
  type: RecordedAction["type"],
): string {
  switch (type) {
    case "fill":
      return "Fill";
    case "check":
      return "Check";
    case "select":
      return "Select";
    default:
      return "Click";
  }
}

/**
 * Strip the C#-naming-convention decorations (leading verb prefix and
 * trailing `Async`) from a user-typed action name so we always store the
 * bare noun. Tolerant of users who type the full decorated form
 * (`ClickLoginButtonAsync`), the un-suffixed form (`ClickLoginButton`),
 * or just the noun (`LoginButton`). Whitespace is trimmed first.
 */
export function normalizeNounForCsharp(name: string): string {
  let s = (name ?? "").trim();
  for (const v of CSHARP_KNOWN_VERBS) {
    if (
      s.length > v.length &&
      s.startsWith(v) &&
      /[A-Z]/.test(s.charAt(v.length))
    ) {
      s = s.slice(v.length);
      break;
    }
  }
  if (s.length > "Async".length && s.endsWith("Async")) {
    s = s.slice(0, -"Async".length);
  }
  return s;
}

/**
 * Build the full C# method name from an action type and the bare noun.
 * Example: `csharpMethodNameFromNoun("fill", "UserName") === "FillUserNameAsync"`.
 */
export function csharpMethodNameFromNoun(
  type: RecordedAction["type"],
  noun: string,
): string {
  return `${csharpVerbForActionType(type)}${noun}${"Async"}`;
}

/**
 * Append the `Async` suffix to a C# test-method name if it isn't already
 * present. C# convention requires async methods to end in `Async`, and
 * every other generated method (page-object methods, `BeforeEachAsync`,
 * `OneTimeSetUpAsync`) already follows it. This helper is the single
 * source of truth for that rule on the server; the test-builder mirrors
 * it in `domain/valueObjects/csharp-noun.ts` for the live preview.
 *
 * The suffix check is case-sensitive (matching the existing convention).
 * Idempotent: applying twice yields the same result. Whitespace is
 * trimmed first so `" RecordedFlow "` becomes `RecordedFlowAsync`.
 */
export function ensureAsyncSuffix(name: string): string {
  const s = (name ?? "").trim();
  if (s === "") return s;
  if (s.endsWith("Async")) return s;
  return `${s}Async`;
}

/**
 * Recover the bare noun from a `${Noun}Selector` key (or return the key
 * unchanged for legacy `${Noun}` keys without the suffix).
 */
export function nounFromSelectorKey(key: string): string {
  if (key.endsWith(SELECTOR_KEY_SUFFIX) && key.length > SELECTOR_KEY_SUFFIX.length) {
    return key.slice(0, -SELECTOR_KEY_SUFFIX.length);
  }
  return key;
}

/**
 * True when `key` follows the new `${Noun}Selector` convention (vs. legacy
 * `${Noun}` entries that may still be present on disk from older
 * recordings).
 */
export function isNewStyleSelectorKey(key: string): boolean {
  return key.endsWith(SELECTOR_KEY_SUFFIX);
}

/**
 * Pure heuristic noun derived from the selector's shape — used when no
 * user-entered name is available. XPath / JS-path selectors fall back to
 * the generic `Element${i+1}` naming.
 */
export function selectorNounFromHeuristic(a: RecordedAction, i: number): string {
  if (
    a.selectorStrategy === "xpath" ||
    a.selectorStrategy === "js-path" ||
    a.selector?.startsWith("xpath=") ||
    a.selector?.startsWith("/")
  ) {
    return `Element${i + 1}`;
  }
  if (a.selector?.startsWith("[data-testid=")) {
    const m = a.selector.match(/\[data-testid="([^"]+)"\]/);
    if (m) return pascal(m[1]!);
  }
  if (a.selector?.startsWith("#")) {
    return pascal(a.selector.slice(1));
  }
  if (a.selector?.startsWith("[aria-label=")) {
    const m = a.selector.match(/\[aria-label="([^"]+)"\]/);
    if (m) return pascal(m[1]!);
  }
  return `Element${i + 1}`;
}

/**
 * Noun for the action: prefer the user-entered (and normalized)
 * `methodName` if it's a legal identifier, otherwise fall back to the
 * selector heuristic. The noun drives both the per-action method name
 * (`${verb}${noun}Async`) and — for the FIRST action of a new selector —
 * the selector key (`${noun}Selector`).
 */
export function nounForAction(a: RecordedAction, fallbackIndex: number): string {
  if (typeof a.methodName === "string") {
    const n = normalizeNounForCsharp(a.methodName);
    if (n && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return n;
  }
  return selectorNounFromHeuristic(a, fallbackIndex);
}

/**
 * `mode` switches between the C# verb-noun-Async convention (the new
 * default) and the pre-task-40 "legacy" convention used by the live UI
 * preview when the project's language is anything other than C#. The
 * legacy mode keeps the suggestion / live-preview output byte-for-byte
 * identical to what the recorder produced before the C# convention
 * shipped, so the Python and Node.js codegen flows (which take
 * `a.methodName` as-is and do their own snake_case-ification) are
 * unaffected by the C#-only change.
 */
export type NamingMode = "csharp" | "legacy";

export function selectorKeyFromAction(
  a: RecordedAction,
  i: number,
  mode: NamingMode = "csharp",
): string {
  if (mode === "legacy") {
    return selectorNounFromHeuristic(a, i);
  }
  return `${nounForAction(a, i)}${SELECTOR_KEY_SUFFIX}`;
}

/**
 * Disambiguate `candidate` against the set of method names already
 * committed to the suite (existing class methods on disk + in-flight
 * peers). The trailing `Async` is preserved while a `2`, `3`, ...
 * suffix is appended to the noun until the decorated name is unique.
 * Returns the original candidate when no suffix is needed.
 */
export function disambiguateMethodName(
  candidate: string,
  used: Set<string>,
): string {
  if (!used.has(candidate)) return candidate;
  // Peel off the trailing `Async` so the suffix lands on the noun, not
  // after `Async` — that way `ClickLoginButtonAsync2` reads naturally.
  const ASYNC = "Async";
  const stem = candidate.endsWith(ASYNC)
    ? candidate.slice(0, -ASYNC.length)
    : candidate;
  const tail = candidate.endsWith(ASYNC) ? ASYNC : "";
  let n = 2;
  let next = `${stem}${n}${tail}`;
  while (used.has(next)) {
    n++;
    next = `${stem}${n}${tail}`;
  }
  return next;
}

export function methodNameFromAction(
  a: RecordedAction,
  key: string,
  i: number,
  mode: NamingMode = "csharp",
): string {
  if (mode === "legacy") {
    // Pre-task-40 form: `${Verb}${Key}${MethodIndex}` (e.g.
    // `ClickSubmit1`). Preserved so non-C# projects keep generating
    // suggestions in their original shape.
    const verb =
      a.type === "fill"
        ? "Fill"
        : a.type === "check"
          ? "Check"
          : a.type === "select"
            ? "Select"
            : "Click";
    return `${verb}${key}${i}`;
  }
  // C# convention: the `i` (method index) parameter is no longer baked
  // into the method name — collision suffixing is now handled separately
  // by `disambiguateMethodName`. It's kept in the signature so callers
  // don't need to be reshuffled.
  void i;
  const verb = csharpVerbForActionType(a.type);
  // Prefer the user-entered noun (after stripping any `Click`/`Async`
  // they typed) so the method name matches what they intended; fall
  // back to the noun encoded in the selector key
  // (`${Noun}Selector` → `Noun`, or the legacy `${Noun}` form unchanged).
  let noun: string;
  if (typeof a.methodName === "string") {
    const n = normalizeNounForCsharp(a.methodName);
    noun = n && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : nounFromSelectorKey(key);
  } else {
    noun = nounFromSelectorKey(key);
  }
  return `${verb}${noun}Async`;
}

/**
 * Normalize a recorded selector for use as a Playwright locator value
 * (both at replay time and inside generated Page Object selector files).
 * XPath selectors that don't already carry the `xpath=` engine prefix —
 * either tagged with `selectorStrategy: "xpath"` or shaped like a bare
 * absolute XPath starting with `/` — are prefixed so Playwright accepts
 * them. All other selectors pass through unchanged.
 */
export function normalizeSelectorForLocator(
  selector: string,
  strategy?: RecordedAction["selectorStrategy"],
): string {
  if (selector.startsWith("xpath=")) return selector;
  if (strategy === "xpath" || selector.startsWith("/")) {
    return `xpath=${selector}`;
  }
  return selector;
}

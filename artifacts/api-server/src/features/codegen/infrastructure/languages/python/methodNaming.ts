/**
 * Verb/noun naming + per-action method-name assignment for Python.
 *
 * The Python codegen uses a verb-noun naming convention
 * (`click_login_button` / `fill_user_name`) keyed off a
 * `${NOUN}_SELECTOR` selector constant. The helpers here drive both
 * the on-disk codegen (`generateSuiteFiles`) and the live preview
 * (`computeTestBodyPreviewPython`) so the two agree byte-for-byte.
 */
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";
import { toPyIdent, toSnake } from "./naming";

/**
 * Sister-suffix constants for the Python verb-noun convention. Mirrors
 * the C# `Selector` / `Element` pair: a Selectors constant
 * `LOGIN_BUTTON_SELECTOR` is wired to a `self.login_button_element`
 * Locator field that page-object methods (`click_login_button`) call
 * into.
 */
export const SELECTOR_KEY_SUFFIX_PY = "_SELECTOR";
export const ELEMENT_FIELD_SUFFIX_PY = "_element";

/**
 * The leading verbs the prompt-input normalizer is willing to peel off so
 * the noun the user types round-trips with the noun the codegen derives
 * from a selector.
 */
const PYTHON_KNOWN_VERBS = ["click", "fill", "check", "select"] as const;

/** Map a recorded-action type to the Python verb (snake-case prefix). */
export function pythonVerbForActionType(
  type: RecordedAction["type"],
): string {
  switch (type) {
    case "fill":
      return "fill";
    case "check":
      return "check";
    case "select":
      return "select";
    default:
      return "click";
  }
}

/**
 * Strip the Python-naming-convention decorations (leading `verb_` prefix)
 * from a user-typed action name so we always store the bare noun.
 */
export function normalizeNounForPython(name: string): string {
  let s = (name ?? "").trim();
  if (!s) return s;
  s = toSnake(s)
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  for (const v of PYTHON_KNOWN_VERBS) {
    const prefix = `${v}_`;
    if (s.length > prefix.length && s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  return s;
}

/**
 * Build the full Python method name from an action type and the bare noun.
 * Example: `pythonMethodNameFromNoun("fill", "user_name") === "fill_user_name"`.
 */
export function pythonMethodNameFromNoun(
  type: RecordedAction["type"],
  noun: string,
): string {
  return `${pythonVerbForActionType(type)}_${noun}`;
}

/**
 * Recover the bare snake_case noun from a `${NOUN}_SELECTOR` key (or
 * return the lowercased key for legacy `${NOUN}` keys without the
 * suffix).
 */
export function nounFromSelectorKeyPython(key: string): string {
  if (
    key.endsWith(SELECTOR_KEY_SUFFIX_PY) &&
    key.length > SELECTOR_KEY_SUFFIX_PY.length
  ) {
    return key.slice(0, -SELECTOR_KEY_SUFFIX_PY.length).toLowerCase();
  }
  return key.toLowerCase();
}

/**
 * True when `key` follows the new `${NOUN}_SELECTOR` convention (vs.
 * legacy `${NOUN}` entries that may still be present on disk from older
 * recordings).
 */
export function isNewStyleSelectorKeyPython(key: string): boolean {
  return key.endsWith(SELECTOR_KEY_SUFFIX_PY);
}

/**
 * Pure heuristic noun derived from the selector's shape — used when no
 * user-entered name is available.
 */
function selectorNounFromHeuristicPython(
  a: RecordedAction,
  i: number,
): string {
  if (
    a.selectorStrategy === "xpath" ||
    a.selectorStrategy === "js-path" ||
    a.selector?.startsWith("xpath=") ||
    a.selector?.startsWith("/")
  ) {
    return `element_${i + 1}`;
  }
  if (a.selector?.startsWith("[data-testid=")) {
    const m = a.selector.match(/\[data-testid="([^"]+)"\]/);
    if (m) return toPyIdent(m[1]!);
  }
  if (a.selector?.startsWith("#")) {
    return toPyIdent(a.selector.slice(1));
  }
  if (a.selector?.startsWith("[aria-label=")) {
    const m = a.selector.match(/\[aria-label="([^"]+)"\]/);
    if (m) return toPyIdent(m[1]!);
  }
  return `element_${i + 1}`;
}

/** Noun for the action: prefer the user-entered (and normalized) name. */
function nounForActionPython(a: RecordedAction, fallbackIndex: number): string {
  if (typeof a.methodName === "string") {
    const n = normalizeNounForPython(a.methodName);
    if (n && /^[a-z_][a-z0-9_]*$/.test(n)) return n;
  }
  return selectorNounFromHeuristicPython(a, fallbackIndex);
}

type PyNamingMode = "python" | "legacy";

export function pythonSelectorKeyFromAction(
  a: RecordedAction,
  i: number,
  mode: PyNamingMode = "python",
): string {
  if (mode === "legacy") {
    return selectorKeyName(a, i);
  }
  const noun = nounForActionPython(a, i);
  return `${noun.toUpperCase()}${SELECTOR_KEY_SUFFIX_PY}`;
}

/** Legacy-mode selector-key shape (UPPER_SNAKE noun, no suffix). */
function selectorKeyName(a: RecordedAction, i: number): string {
  const fallback = `ELEMENT_${i + 1}`;
  if (
    a.selectorStrategy === "xpath" ||
    a.selectorStrategy === "js-path" ||
    a.selector?.startsWith("xpath=") ||
    a.selector?.startsWith("/")
  ) {
    return fallback;
  }
  const fromAttr = (s: string): string =>
    toSnake(s).toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  if (a.selector?.startsWith("[data-testid=")) {
    const m = a.selector.match(/\[data-testid="([^"]+)"\]/);
    if (m) return fromAttr(m[1]!);
  }
  if (a.selector?.startsWith("#")) {
    return fromAttr(a.selector.slice(1));
  }
  if (a.selector?.startsWith("[aria-label=")) {
    const m = a.selector.match(/\[aria-label="([^"]+)"\]/);
    if (m) return fromAttr(m[1]!);
  }
  return fallback;
}

export function pythonMethodNameFromAction(
  a: RecordedAction,
  key: string,
  i: number,
  mode: PyNamingMode = "python",
): string {
  const verb = pythonVerbForActionType(a.type);
  if (mode === "legacy") {
    return `${verb}_${key.toLowerCase()}_${i}`;
  }
  void i;
  let noun: string;
  if (typeof a.methodName === "string") {
    const n = normalizeNounForPython(a.methodName);
    noun = n && /^[a-z_][a-z0-9_]*$/.test(n) ? n : nounFromSelectorKeyPython(key);
  } else {
    noun = nounFromSelectorKeyPython(key);
  }
  return `${verb}_${noun}`;
}

/**
 * Disambiguate `candidate` by appending `_2`, `_3`, ... until the name
 * is no longer present in `used`. Snake-case style numeric suffix.
 */
export function disambiguateMethodNamePython(
  candidate: string,
  used: Set<string>,
): string {
  if (!used.has(candidate)) return candidate;
  let n = 2;
  let next = `${candidate}_${n}`;
  while (used.has(next)) {
    n++;
    next = `${candidate}_${n}`;
  }
  return next;
}

/**
 * Compute the per-action method name map for an in-progress Python
 * recording. Mirrors `generateSuiteFiles`'s selector-key + method-name
 * assignment so callers (e.g. the live test-body preview) can build the
 * same names without doing I/O.
 */
export function computeMethodNamesForActionsPython(
  actions: RecordedAction[],
  existingSelectors: Map<string, string> = new Map(),
): Map<RecordedAction, string> {
  const bySelector = new Map<string, string>();
  const valueByKey = new Map<string, string>(existingSelectors);
  let fallbackIndex = 0;
  for (const a of actions) {
    if (a.deleted) continue;
    if (a.type === "assert" || a.type === "wait") continue;
    if (!a.selector || bySelector.has(a.selector)) continue;
    let reused = false;
    for (const [k, v] of valueByKey) {
      if (v === a.selector) {
        bySelector.set(a.selector, k);
        reused = true;
        break;
      }
    }
    if (reused) continue;
    let key = pythonSelectorKeyFromAction(a, fallbackIndex);
    while (valueByKey.has(key)) {
      fallbackIndex++;
      key = `ELEMENT_${fallbackIndex + 1}${SELECTOR_KEY_SUFFIX_PY}`;
    }
    if (nounFromSelectorKeyPython(key).startsWith("element_")) fallbackIndex++;
    valueByKey.set(key, a.selector);
    bySelector.set(a.selector, key);
  }

  const out = new Map<RecordedAction, string>();
  const used = new Set<string>();
  let methodIndex = 0;
  for (const a of actions) {
    if (a.deleted) continue;
    if (a.type === "assert" || a.type === "wait") continue;
    if (!a.selector) continue;
    const key = bySelector.get(a.selector);
    if (!key) continue;
    methodIndex++;
    const candidate = pythonMethodNameFromAction(a, key, methodIndex);
    const finalName = disambiguateMethodNamePython(candidate, used);
    used.add(finalName);
    out.set(a, finalName);
  }
  return out;
}

/**
 * Suggest the full Python method name for the *last* recorded action in
 * `actions`. Used to pre-fill the workbench rename prompt's live preview.
 */
export function suggestedMethodNameForLastActionPython(
  actions: RecordedAction[],
): string | null {
  const last = actions[actions.length - 1];
  if (!last || !last.selector) return null;
  const map = computeMethodNamesForActionsPython(actions);
  return map.get(last) ?? null;
}

/**
 * Like `suggestedMethodNameForLastActionPython`, but returns just the
 * bare snake_case noun the recorder pre-fills into the rename prompt.
 */
export function suggestedActionNounForLastActionPython(
  actions: RecordedAction[],
): string | null {
  const last = actions[actions.length - 1];
  if (!last || !last.selector) return null;
  if (typeof last.methodName === "string") {
    const n = normalizeNounForPython(last.methodName);
    if (n && /^[a-z_][a-z0-9_]*$/.test(n)) return n;
  }
  const bySelector = new Map<string, string>();
  const valueByKey = new Map<string, string>();
  let fallbackIndex = 0;
  let lastKey: string | null = null;
  for (const a of actions) {
    if (!a.selector) continue;
    if (!bySelector.has(a.selector)) {
      let reused = false;
      for (const [k, v] of valueByKey) {
        if (v === a.selector) {
          bySelector.set(a.selector, k);
          reused = true;
          break;
        }
      }
      if (!reused) {
        let key = pythonSelectorKeyFromAction(a, fallbackIndex);
        while (valueByKey.has(key)) {
          fallbackIndex++;
          key = `ELEMENT_${fallbackIndex + 1}${SELECTOR_KEY_SUFFIX_PY}`;
        }
        if (nounFromSelectorKeyPython(key).startsWith("element_"))
          fallbackIndex++;
        valueByKey.set(key, a.selector);
        bySelector.set(a.selector, key);
      }
    }
    if (a === last) lastKey = bySelector.get(a.selector) ?? null;
  }
  if (!lastKey) return null;
  return nounFromSelectorKeyPython(lastKey);
}

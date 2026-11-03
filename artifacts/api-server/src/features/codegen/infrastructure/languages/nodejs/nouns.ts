import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";
import {
  NODEJS_KNOWN_VERBS,
  type NodeNamingMode,
  SELECTOR_KEY_SUFFIX_NODE,
  toCamel,
} from "./naming";

/** Map a recorded-action type to the Node.js verb (camelCase prefix). */
export function nodejsVerbForActionType(
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

/** Strip the Node.js verb prefix to recover the bare camelCase noun. */
export function normalizeNounForNodejs(name: string): string {
  let s = (name ?? "").trim();
  if (!s) return s;
  s = toCamel(s);
  for (const v of NODEJS_KNOWN_VERBS) {
    if (
      s.length > v.length &&
      s.startsWith(v) &&
      /[A-Z]/.test(s.charAt(v.length))
    ) {
      const rest = s.slice(v.length);
      s = rest.charAt(0).toLowerCase() + rest.slice(1);
      break;
    }
  }
  return s;
}

/** Build the full Node.js method name from an action type and the noun. */
export function nodejsMethodNameFromNoun(
  type: RecordedAction["type"],
  noun: string,
): string {
  if (!noun) return nodejsVerbForActionType(type);
  const cap = noun.charAt(0).toUpperCase() + noun.slice(1);
  return `${nodejsVerbForActionType(type)}${cap}`;
}

/** Recover the bare camelCase noun from a `${noun}Selector` key. */
export function nounFromSelectorKeyNodejs(key: string): string {
  if (
    key.endsWith(SELECTOR_KEY_SUFFIX_NODE) &&
    key.length > SELECTOR_KEY_SUFFIX_NODE.length
  ) {
    const head = key.slice(0, -SELECTOR_KEY_SUFFIX_NODE.length);
    return head.charAt(0).toLowerCase() + head.slice(1);
  }
  return key;
}

export function isNewStyleSelectorKeyNodejs(key: string): boolean {
  return key.endsWith(SELECTOR_KEY_SUFFIX_NODE);
}

function selectorNounFromHeuristicNodejs(
  a: RecordedAction,
  i: number,
): string {
  if (
    a.selectorStrategy === "xpath" ||
    a.selectorStrategy === "js-path" ||
    a.selector?.startsWith("xpath=") ||
    a.selector?.startsWith("/")
  ) {
    return `element${i + 1}`;
  }
  if (a.selector?.startsWith("[data-testid=")) {
    const m = a.selector.match(/\[data-testid="([^"]+)"\]/);
    if (m) return toCamel(m[1]!);
  }
  if (a.selector?.startsWith("#")) {
    return toCamel(a.selector.slice(1));
  }
  if (a.selector?.startsWith("[aria-label=")) {
    const m = a.selector.match(/\[aria-label="([^"]+)"\]/);
    if (m) return toCamel(m[1]!);
  }
  return `element${i + 1}`;
}

function nounForActionNodejs(a: RecordedAction, fallbackIndex: number): string {
  if (typeof a.methodName === "string") {
    const n = normalizeNounForNodejs(a.methodName);
    if (n && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return n;
  }
  return selectorNounFromHeuristicNodejs(a, fallbackIndex);
}

export function nodejsSelectorKeyFromAction(
  a: RecordedAction,
  i: number,
  mode: NodeNamingMode = "nodejs",
): string {
  if (mode === "legacy") {
    return legacySelectorKeyName(a, i);
  }
  const noun = nounForActionNodejs(a, i);
  return `${noun}${SELECTOR_KEY_SUFFIX_NODE}`;
}

function legacySelectorKeyName(a: RecordedAction, i: number): string {
  const fallback = `element${i + 1}`;
  if (
    a.selectorStrategy === "xpath" ||
    a.selectorStrategy === "js-path" ||
    a.selector?.startsWith("xpath=") ||
    a.selector?.startsWith("/")
  ) {
    return fallback;
  }
  if (a.selector?.startsWith("[data-testid=")) {
    const m = a.selector.match(/\[data-testid="([^"]+)"\]/);
    if (m) return toCamel(m[1]!);
  }
  if (a.selector?.startsWith("#")) {
    return toCamel(a.selector.slice(1));
  }
  if (a.selector?.startsWith("[aria-label=")) {
    const m = a.selector.match(/\[aria-label="([^"]+)"\]/);
    if (m) return toCamel(m[1]!);
  }
  return fallback;
}

export function nodejsMethodNameFromAction(
  a: RecordedAction,
  key: string,
  i: number,
  mode: NodeNamingMode = "nodejs",
): string {
  const verb = nodejsVerbForActionType(a.type);
  if (mode === "legacy") {
    const cap = key.charAt(0).toUpperCase() + key.slice(1);
    return `${verb}${cap}${i}`;
  }
  void i;
  let noun: string;
  if (typeof a.methodName === "string") {
    const n = normalizeNounForNodejs(a.methodName);
    noun =
      n && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)
        ? n
        : nounFromSelectorKeyNodejs(key);
  } else {
    noun = nounFromSelectorKeyNodejs(key);
  }
  const cap = noun.charAt(0).toUpperCase() + noun.slice(1);
  return `${verb}${cap}`;
}

export function disambiguateMethodNameNodejs(
  candidate: string,
  used: Set<string>,
): string {
  if (!used.has(candidate)) return candidate;
  let n = 2;
  let next = `${candidate}${n}`;
  while (used.has(next)) {
    n++;
    next = `${candidate}${n}`;
  }
  return next;
}

/** Pull existing `KEY: "value"` entries from a previously-generated Selectors file. */
export function existingTsSelectorKeys(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.set(m[1]!, m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return out;
}

/** Pull existing method names from an actions-class file. */
export function existingTsActionMethodNames(content: string): Set<string> {
  const out = new Set<string>();
  const re = /^\s*(?:async\s+)?([a-zA-Z_][\w]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1]!;
    if (name === "constructor") continue;
    if (name === "import" || name === "export" || name === "class") continue;
    out.add(name);
  }
  return out;
}

import type { HookKind } from "@/features/codegen/infrastructure/codegen";

/** Lower-camel an arbitrary string (`UserName` / `user-name` → `userName`). */
export function toCamel(s: string): string {
  const parts = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return "x";
  const head = parts[0]!;
  const rest = parts.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const camel = head.charAt(0).toLowerCase() + head.slice(1) + rest.join("");
  return /^[A-Za-z_]/.test(camel) ? camel : `x${camel}`;
}

/** PascalCase an arbitrary string (`user_name` → `UserName`). */
export function toPascal(s: string): string {
  const parts = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return "X";
  return parts
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

export const NODEJS_HOOK_INFO: Record<HookKind, { method: string; api: string }> = {
  beforeEach: { method: "beforeEach", api: "test.beforeEach" },
  oneTimeSetup: { method: "beforeAll", api: "test.beforeAll" },
};

/** Public alias of `hookMethodName` for Node.js. */
export function hookMethodNameNodejs(hook: HookKind): string {
  return NODEJS_HOOK_INFO[hook].method;
}

/** Render a TypeScript double-quoted literal with backslash + quote escaping. */
export function tsQuotedArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function escapeTs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Kebab-case a suite name for filenames (`LoginFlow` → `login-flow`). */
export function suiteKebab(suiteName: string): string {
  return suiteName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

export const SELECTOR_KEY_SUFFIX_NODE = "Selector";
export const ELEMENT_FIELD_SUFFIX_NODE = "Element";

export const NODEJS_KNOWN_VERBS = ["click", "fill", "check", "select"] as const;

export type NodeNamingMode = "nodejs" | "legacy";

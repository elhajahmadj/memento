// Java naming helpers extracted from the original javaCodegen monolith.
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

export const JAVA_HOOK_INFO: Record<
  HookKind,
  { method: string; annotation: string; isStatic: boolean }
> = {
  beforeEach: { method: "beforeEach", annotation: "@BeforeEach", isStatic: false },
  oneTimeSetup: { method: "beforeAll", annotation: "@BeforeAll", isStatic: true },
};

/** Public alias of `hookMethodName` for Java. */
export function hookMethodNameJava(hook: HookKind): string {
  return JAVA_HOOK_INFO[hook].method;
}

/** Render a Java double-quoted literal with backslash + quote escaping. */
export function javaQuotedArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

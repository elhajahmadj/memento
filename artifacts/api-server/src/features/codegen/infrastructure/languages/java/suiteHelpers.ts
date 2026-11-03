// Lower-level helpers shared by suite-file generation.
import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";
import { toCamel } from "./naming";
import { actionsFileRelPath } from "./paths";

export function existingJavaSelectorKeys(content: string): Map<string, string> {
  const out = new Map<string, string>();
  // Match `public static final String userName = "value";`
  const re = /^\s*public\s+static\s+final\s+String\s+([A-Za-z_]\w*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.set(m[1]!, m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return out;
}

export function existingJavaActionMethodNames(content: string): Set<string> {
  const out = new Set<string>();
  // Match `public void name(...)` or `void name(...)` at class-member indent.
  // Skip the constructor (matches the class name, preceded by `public`).
  const re = /^\s*(?:public\s+|private\s+|protected\s+)?void\s+([A-Za-z_]\w*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.add(m[1]!);
  }
  return out;
}

// Pull `void name(args);` signatures (without the trailing `;`) out of a
// previously-emitted interface file so we can preserve user-edited entries
// when merging in newly-recorded methods.
export function existingJavaInterfaceSignatures(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^\s*void\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1]!;
    const args = m[2]!.replace(/\s+/g, " ").trim();
    out.set(name, `void ${name}(${args})`);
  }
  return out;
}

function selectorKeyName(s: string, fallbackIndex: number): string {
  if (!s) return `element${fallbackIndex + 1}`;
  return toCamel(s);
}

export function javaSelectorKeyFromAction(a: RecordedAction, i: number): string {
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
    if (m) return selectorKeyName(m[1]!, i);
  }
  if (a.selector?.startsWith("#")) {
    return selectorKeyName(a.selector.slice(1), i);
  }
  if (a.selector?.startsWith("[aria-label=")) {
    const m = a.selector.match(/\[aria-label="([^"]+)"\]/);
    if (m) return selectorKeyName(m[1]!, i);
  }
  return fallback;
}

export function javaMethodNameFromAction(
  a: RecordedAction,
  key: string,
  i: number,
): string {
  const verb =
    a.type === "fill"
      ? "fill"
      : a.type === "check"
        ? "check"
        : a.type === "select"
          ? "select"
          : "click";
  const cap = key.charAt(0).toUpperCase() + key.slice(1);
  return `${verb}${cap}${i}`;
}

export async function readIfExists(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Read the names of methods declared on the actions class for `suiteName`.
 * Mirrors the C# / Python / Node.js variant so the recorder can reject
 * custom names that would collide with existing methods on the same suite.
 */
export async function readSuiteActionsMethodNames(
  project: Project,
  suiteName: string,
): Promise<Set<string>> {
  const rel = actionsFileRelPath(project, suiteName);
  const raw = await readIfExists(safeJoin(project.rootPath, rel));
  if (!raw) return new Set();
  return existingJavaActionMethodNames(raw);
}

/** Same shape as the C# / Python / Node.js variant. */
export function suggestNonCollidingName(
  desired: string,
  used: Set<string>,
): string {
  if (!used.has(desired)) return desired;
  let suffix = 2;
  while (used.has(`${desired}${suffix}`)) suffix++;
  return `${desired}${suffix}`;
}

export function escapeJava(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Extract method bodies from a previously-generated Actions class
// (everything between the constructor's `}` and the class's closing `}`).
export function extractActionsClassMethods(content: string): string {
  const lines = content.split(/\r?\n/);
  // Find the constructor line: matches `    public <ClassName>(...)`.
  let ctorIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*public\s+[A-Z][A-Za-z0-9_]*\s*\(/.test(lines[i]!)) {
      ctorIdx = i;
      break;
    }
  }
  if (ctorIdx === -1) return "";
  // Walk forward to the constructor's closing `}` at member indent (4 spaces).
  let cursor = ctorIdx + 1;
  for (; cursor < lines.length; cursor++) {
    if (/^\s{4}\}\s*$/.test(lines[cursor]!)) {
      cursor++;
      break;
    }
  }
  while (cursor < lines.length && lines[cursor]!.trim() === "") cursor++;
  // Collect everything from `cursor` until the class closing `}` at column 0.
  const body: string[] = [];
  for (let i = cursor; i < lines.length; i++) {
    const ln = lines[i]!;
    if (/^\}\s*$/.test(ln)) break;
    body.push(ln);
  }
  while (body.length && body[0]!.trim() === "") body.shift();
  while (body.length && body[body.length - 1]!.trim() === "") body.pop();
  return body.join("\n");
}

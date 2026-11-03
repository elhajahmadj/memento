/**
 * Hook (`one_time_setup` / `before_each`) body manipulation. Line-based
 * scanning over the Python class layout — see `findHookSpan` for the
 * scan contract.
 */
import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import type { HookKind } from "@/features/codegen/infrastructure/codegen";
import { PYTHON_HOOK_INFO } from "./naming";

interface HookSpan {
  /** Index of `    def <hook>(...):` line. */
  defLine: number;
  /** Indent string of the def line (e.g. `    `). */
  defIndent: string;
  /** Indent string of the body (def indent + 4 spaces). */
  bodyIndent: string;
  /** Index of the `yield` line that closes the body. */
  yieldLine: number;
}

/**
 * Locate a hook fixture inside a Python test class file.
 *
 * The Python recorder emits hooks as `@pytest.fixture(...) def <hook>(...):`
 * methods that always end with a `yield` line, so locating one is just:
 *   1) find `def <hook>(` at any indent that's "inside a class"
 *   2) walk forward to the first `yield` at body indent
 *
 * Returns `null` if the hook is missing or malformed (no body indent /
 * no yield), in which case callers treat the hook as absent.
 */
function findHookSpan(text: string, hook: HookKind): HookSpan | null {
  const lines = text.split(/\r?\n/);
  const method = PYTHON_HOOK_INFO[hook].method;
  const defRe = new RegExp(String.raw`^(\s*)def\s+${method}\s*\(`);
  let defLine = -1;
  let defIndent = "";
  for (let i = 0; i < lines.length; i++) {
    const m = defRe.exec(lines[i]!);
    if (m) {
      defLine = i;
      defIndent = m[1]!;
      break;
    }
  }
  if (defLine === -1) return null;

  const bodyIndent = `${defIndent}    `;
  let yieldLine = -1;
  for (let i = defLine + 1; i < lines.length; i++) {
    const ln = lines[i]!;
    if (ln.trim().length > 0 && !ln.startsWith(bodyIndent)) break;
    if (ln.trim() === "yield") {
      yieldLine = i;
      break;
    }
  }
  if (yieldLine === -1) return null;
  return { defLine, defIndent, bodyIndent, yieldLine };
}

/**
 * Read the raw hook body (between def line and yield line) as a single
 * string with newlines. Returns `null` when the hook is missing.
 *
 * Mirrors the C# variant but uses Python line scanning instead of brace
 * matching.
 */
export async function readHookBody(
  project: Project,
  fileRelPath: string,
  hook: HookKind,
): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(safeJoin(project.rootPath, fileRelPath), "utf8");
  } catch {
    return null;
  }
  const span = findHookSpan(text, hook);
  if (!span) return null;
  const lines = text.split(/\r?\n/);
  return lines.slice(span.defLine + 1, span.yieldLine).join("\n");
}

/**
 * A "default stub" hook is one that's empty or contains only the placeholder
 * comment we emit in `generateTestClass`. Used by the UI to warn before a
 * recording overwrites a real, user-edited hook.
 */
export async function isHookDefaultStub(
  project: Project,
  fileRelPath: string,
  hook: HookKind,
): Promise<boolean> {
  const body = await readHookBody(project, fileRelPath, hook);
  if (body === null) return true;
  const meaningful = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  return meaningful.length === 0;
}

export interface ReplaceHookBodyResult {
  backupPath: string | null;
}

/**
 * Replace the body of a hook fixture with `bodyLines` (already-indented
 * statements; we re-indent them to the body indent of the target file).
 *
 * Python doesn't write `.bak` files (hook backups are a C# nicety not
 * carried over per the task deviations), so `backupPath` is always `null`.
 */
export async function replaceHookBody(
  project: Project,
  fileRelPath: string,
  hook: HookKind,
  bodyLines: string[],
): Promise<ReplaceHookBodyResult> {
  const abs = safeJoin(project.rootPath, fileRelPath);
  const original = await fs.readFile(abs, "utf8");
  const span = findHookSpan(original, hook);
  if (!span) {
    throw new Error(
      `Hook '${PYTHON_HOOK_INFO[hook].method}' not found in ${fileRelPath}`,
    );
  }
  const lines = original.split(/\r?\n/);
  const newBody =
    bodyLines.length > 0
      ? bodyLines.map((l) => `${span.bodyIndent}${l}`)
      : [`${span.bodyIndent}pass`];
  const next = [
    ...lines.slice(0, span.defLine + 1),
    ...newBody,
    `${span.bodyIndent}yield`,
    ...lines.slice(span.yieldLine + 1),
  ];
  await fs.writeFile(abs, next.join("\n"));
  return { backupPath: null };
}

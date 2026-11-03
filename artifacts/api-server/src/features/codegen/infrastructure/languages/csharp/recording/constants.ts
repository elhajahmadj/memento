/**
 * Per-suite `Constants/{Stem}Constants.cs` and
 * `TestCategories/{Stem}TestCategories.cs` readers / writers / upserters.
 * Lets recordings hoist literal `Fill(...)` values into named constants
 * and add NUnit `[Category]` references that survive re-recording.
 */
import fs from "node:fs/promises";
import type { Project } from "@/features/projects/domain/types";
import { writeFile } from "@/features/projects/infrastructure/projectFiles";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { RecordedAction } from "@/features/codegen/domain/types";
import {
  suiteConstantsClassName,
  suiteConstantsRelPath,
  suiteTestCategoriesClassName,
  suiteTestCategoriesRelPath,
} from "./identifiers";

/**
 * Derive the constant name to host a recorded `Fill*` literal. The
 * recorder names every fill page-method `Fill{Noun}Async` (and
 * historically `Fill{Noun}{N}` from earlier recordings); the constant
 * key is the bare noun, so the generated test reads
 * `Constants.UserName` instead of `"batman"`. Tolerates an optional
 * trailing collision-suffix `2`/`3`/... that the recorder may insert
 * between the noun and the `Async` suffix. Returns null if the method
 * name is not a `Fill*` method.
 */
export function deriveConstantName(methodName: string): string | null {
  const m = methodName.match(/^Fill(.+?)(\d+)?(?:Async)?$/);
  if (!m) return null;
  const base = m[1] ?? "";
  if (!base) return null;
  return base;
}

/**
 * Build the constants map for a sequence of recorded actions. Only `fill`
 * actions with a non-empty value are extracted. When two fills derive
 * the same constant name with different values, later ones receive a
 * `_2`, `_3`, … suffix so each literal stays addressable. Returns:
 *   - `byMethod`: methodName -> constantName  (used to rewrite test body)
 *   - `byName`:   constantName -> value       (used to render Constants.cs)
 */
export function buildFillConstants(
  actions: RecordedAction[],
  methodNames: Map<RecordedAction, string>,
  existing: Map<string, string> = new Map(),
): {
  byMethod: Map<string, string>;
  byName: Map<string, string>;
} {
  const byMethod = new Map<string, string>();
  const byName = new Map<string, string>(existing);
  for (const a of actions) {
    if (a.deleted) continue;
    if (a.type !== "fill") continue;
    const value = a.value ?? "";
    if (!value) continue;
    const methodName = methodNames.get(a);
    if (!methodName) continue;
    if (byMethod.has(methodName)) continue;
    const base = deriveConstantName(methodName);
    if (!base) continue;
    let chosen = base;
    let n = 2;
    while (byName.has(chosen) && byName.get(chosen) !== value) {
      chosen = `${base}_${n++}`;
    }
    byName.set(chosen, value);
    byMethod.set(methodName, chosen);
  }
  return { byMethod, byName };
}

export const CONSTANTS_LINE_RE =
  /public\s+const\s+string\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g;

function unescapeCsString(literal: string): string {
  return literal.replace(/\\(.)/g, "$1");
}

/**
 * Read the per-suite `Constants/{Suite}Constants.cs` file (if present)
 * and return its `name -> value` map. Lets `stop()` merge new
 * constants without clobbering ones from earlier recordings.
 */
export async function readRecordedConstants(
  project: Project,
  suiteName: string = "",
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!suiteName) return out;
  const abs = safeJoin(
    project.rootPath,
    suiteConstantsRelPath(project, suiteName),
  );
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf8");
  } catch {
    return out;
  }
  CONSTANTS_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CONSTANTS_LINE_RE.exec(raw)) !== null) {
    out.set(m[1]!, unescapeCsString(m[2]!));
  }
  return out;
}

/**
 * Render and write `{TestProject}/Constants/{Suite}Constants.cs` from
 * `byName`. The generated file is a single static class under
 * `{namespace}.Tests.Constants` containing one `public const string`
 * per entry. Caller is responsible for merging with
 * `readRecordedConstants` first so prior values are preserved.
 */
export async function writeRecordedConstants(
  project: Project,
  byName: Map<string, string>,
  suiteName: string = "",
): Promise<string> {
  if (!suiteName) {
    throw new Error("writeRecordedConstants requires a non-empty suiteName");
  }
  const rel = suiteConstantsRelPath(project, suiteName);
  const className = suiteConstantsClassName(suiteName);
  const names = Array.from(byName.keys()).sort((a, b) => a.localeCompare(b));
  const lines = names.map(
    (k) =>
      `        public const string ${k} = "${(byName.get(k) ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}";`,
  );
  const content = `namespace ${project.namespace}.Tests.Constants
{
    public static class ${className}
    {
${lines.join("\n")}
    }
}
`;
  await writeFile(project, rel, content);
  return rel;
}

/**
 * Idempotent upsert into `{TestProject}/TestCategories/{Suite}TestCategories.cs`.
 * Adds (or replaces) a `public const string {constName} = "{value}"`
 * entry so re-recording the same category never produces a duplicate.
 * Returns the relative path written.
 */
export async function upsertCategoryConstant(
  project: Project,
  suiteName: string,
  constName: string,
  value: string,
): Promise<string> {
  if (!suiteName) {
    throw new Error("upsertCategoryConstant requires a non-empty suiteName");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(constName)) {
    throw new Error(
      `Category constant name must be a valid C# identifier: ${constName}`,
    );
  }
  const rel = suiteTestCategoriesRelPath(project, suiteName);
  const className = suiteTestCategoriesClassName(suiteName);
  const abs = safeJoin(project.rootPath, rel);
  const escaped = (value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  let existing: string | null = null;
  try {
    existing = await fs.readFile(abs, "utf8");
  } catch {
    existing = null;
  }
  const constLine = `        public const string ${constName} = "${escaped}";`;

  if (existing) {
    const re = new RegExp(
      `^[\\t ]*public const string ${constName}\\s*=\\s*"[^"]*"\\s*;\\s*$`,
      "m",
    );
    let next: string;
    if (re.test(existing)) {
      next = existing.replace(re, constLine);
    } else {
      // Insert before the closing brace of the class.
      const classOpenRe = new RegExp(
        `public static class ${className}\\s*\\{`,
      );
      const m = classOpenRe.exec(existing);
      if (m) {
        const openEnd = m.index + m[0].length;
        let depth = 1;
        let close = -1;
        for (let i = openEnd; i < existing.length; i++) {
          const ch = existing[i];
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) {
              close = i;
              break;
            }
          }
        }
        if (close !== -1) {
          next = existing.slice(0, close) + `${constLine}\n    ` + existing.slice(close);
        } else {
          next = renderTestCategoriesFile(project, className, [
            { name: constName, line: constLine },
          ]);
        }
      } else {
        next = renderTestCategoriesFile(project, className, [
          { name: constName, line: constLine },
        ]);
      }
    }
    await writeFile(project, rel, next);
    return rel;
  }

  await writeFile(
    project,
    rel,
    renderTestCategoriesFile(project, className, [
      { name: constName, line: constLine },
    ]),
  );
  return rel;
}

function renderTestCategoriesFile(
  project: Project,
  className: string,
  entries: Array<{ name: string; line: string }>,
): string {
  const body = entries.map((e) => e.line).join("\n");
  return `namespace ${project.namespace}.Tests.TestCategories
{
    public static class ${className}
    {
${body}
    }
}
`;
}

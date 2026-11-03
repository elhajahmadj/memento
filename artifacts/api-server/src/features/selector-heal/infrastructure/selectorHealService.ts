import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, recordedActionSetsTable } from "@workspace/db";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";
import type { Project } from "@/features/projects/infrastructure/projectService";

/**
 * "Fix selector" service. Given a (user, project) and an old selector
 * string, replace it with a new selector across:
 *
 *   1. Every persisted RecordedAction set the user owns for that
 *      project — both the `selector` field and the wait action's
 *      `waitSelector` field on every action.
 *   2. The on-disk Selectors files for every suite already generated
 *      into the project's filesystem fork. Selectors files store
 *      string-literal mappings of `KeyName -> selectorValue`, so we
 *      do a value match (not key match) and rewrite the literal.
 *      Files that do not contain the value are left alone.
 *
 * The on-disk pass is per-language (csharp / python / nodejs / java)
 * because each scaffold writes Selectors files in a different shape
 * and to a different folder. The shapes are:
 *
 *   csharp : <TestProject>/PageObjects/Selectors/<Suite>Selectors.cs
 *            `public static readonly string Key = "value";`
 *   python : pages/selectors/<suite>_selectors.py
 *            `KEY = "value"`
 *   nodejs : pages/selectors/<Suite>Selectors.ts
 *            `  key: "value",`
 *   java   : <TestsModule>/.../pages/selectors/<Suite>Selectors.java
 *            `public static final String key = "value";`
 *
 * `dryRun` skips DB writes AND file writes so the UI can preview the
 * diff confirmation modal without committing. `details` enumerates
 * every site that would change so the modal can list them.
 */

/**
 * A single before/after snippet showing one site that would change.
 * `location` is human-readable: `step 3` for an action in a recording,
 * `line 42` for a literal in a Selectors file. The dialog renders this
 * verbatim so the user can scroll through every site they're about to
 * touch instead of only seeing per-file replacement counts.
 */
export interface HealResultSite {
  location: string;
  before: string;
  after: string;
}

export interface HealResultDetail {
  filePath: string;
  kind: string;
  methodName: string | null;
  replacements: number;
  sites: HealResultSite[];
}

export interface HealResultFileDetail {
  filePath: string;
  /** Selector key name(s) on disk that mapped to the old value. */
  keys: string[];
  replacements: number;
  sites: HealResultSite[];
}

export interface HealResult {
  oldSelector: string;
  newSelector: string;
  totalReplacements: number;
  recordingsChanged: number;
  details: HealResultDetail[];
  filesChanged: number;
  fileDetails: HealResultFileDetail[];
}

/**
 * Compact one-line summary of a RecordedAction for the dry-run preview.
 * Renders only the fields a human typically wants to see when judging a
 * selector swap: the verb, the selector(s), and a short value/url hint.
 */
function describeAction(a: RecordedAction): string {
  const parts: string[] = [a.type];
  if (a.selector !== undefined) {
    parts.push(`selector=${JSON.stringify(a.selector)}`);
  }
  if (a.type === "wait" && a.waitSelector !== undefined) {
    parts.push(`waitSelector=${JSON.stringify(a.waitSelector)}`);
  }
  if (a.value !== undefined) {
    const v = a.value.length > 40 ? `${a.value.slice(0, 40)}…` : a.value;
    parts.push(`value=${JSON.stringify(v)}`);
  }
  if (a.url !== undefined) {
    parts.push(`url=${JSON.stringify(a.url)}`);
  }
  return parts.join(" ");
}

function rewriteActions(
  actions: RecordedAction[],
  oldSel: string,
  newSel: string,
): {
  changed: boolean;
  count: number;
  next: RecordedAction[];
  sites: HealResultSite[];
} {
  let count = 0;
  const sites: HealResultSite[] = [];
  const next = actions.map((a, idx) => {
    let copy: RecordedAction | null = null;
    const before = a;
    if (a.selector === oldSel) {
      copy = { ...a, selector: newSel };
      sites.push({
        location: `step ${idx + 1}`,
        before: describeAction(before),
        after: describeAction(copy),
      });
      count++;
    }
    if (a.type === "wait" && a.waitSelector === oldSel) {
      const beforeWait = copy ?? a;
      const afterWait = { ...beforeWait, waitSelector: newSel } as RecordedAction;
      sites.push({
        location: `step ${idx + 1} (wait)`,
        before: describeAction(beforeWait),
        after: describeAction(afterWait),
      });
      copy = afterWait;
      count++;
    }
    return copy ?? a;
  });
  return { changed: count > 0, count, next, sites };
}

function escapeForCsharp(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeForJava(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeForTs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeForPython(value: string): string {
  // Python files in this codebase store selectors with double quotes
  // and no escaping (selectors are simple CSS / role / xpath strings,
  // none of which contain `"` or `\`). We still escape defensively
  // so a user-supplied `newSelector` that contains a `"` survives.
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Per-language Selectors-file descriptor: where they live (relative to
 * `project.rootPath`), how to recognize the matching files, the regex
 * that captures `(key, value)` pairs, and how to rewrite a literal
 * value to a new one. Returning a single descriptor per language
 * keeps the heal loop in `healFilesForProject` language-agnostic.
 */
interface SelectorsFileShape {
  /** Directory (relative to project.rootPath) holding Selectors files. */
  dir: string;
  /** True for files that are this language's Selectors files. */
  fileFilter: (name: string) => boolean;
  /**
   * Regex with capture groups (1=key, 2=value). Must use the `g` flag
   * so iterative replacements work cleanly.
   */
  pairRegex: RegExp;
  /** Build the replacement literal for (key, newValue). */
  buildReplacement: (key: string, newValue: string) => string;
}

function shapesFor(project: Project): SelectorsFileShape[] {
  const language = project.language ?? "csharp";
  switch (language) {
    case "python":
      return [
        {
          dir: "pages/selectors",
          fileFilter: (n) => n.endsWith("_selectors.py"),
          // `KEY = "value"` (top-level module constants).
          pairRegex:
            /^([ \t]*)([A-Z_][A-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/gm,
          buildReplacement: (key, val) => `${key} = "${escapeForPython(val)}"`,
        },
      ];
    case "nodejs":
      return [
        {
          dir: "pages/selectors",
          fileFilter: (n) => n.endsWith("Selectors.ts"),
          // `  key: "value",` inside the exported object literal.
          pairRegex:
            /^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/gm,
          buildReplacement: (key, val) => `  ${key}: "${escapeForTs(val)}",`,
        },
      ];
    case "java":
      // Java Selectors files live under the tests module's java
      // sources tree, but we don't want to pull the full path-builder
      // here (it depends on package layout). Walk the entire
      // `pages/selectors` directory under each `src/test/java`
      // subtree we can find — the Selectors files are the only files
      // that match the fileFilter so we only rewrite the right ones.
      return [
        {
          // Empty `dir` means "walk from rootPath looking for files".
          // healFilesForProject treats this as a recursive walk.
          dir: "",
          fileFilter: (n) => n.endsWith("Selectors.java"),
          pairRegex:
            /^([ \t]*)public\s+static\s+final\s+String\s+([A-Za-z_]\w*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*;\s*$/gm,
          buildReplacement: (key, val) =>
            `    public static final String ${key} = "${escapeForJava(val)}";`,
        },
      ];
    default:
      // C# (default) — Selectors files live next to the test project
      // under `<TestProject>/PageObjects/Selectors/<Suite>Selectors.cs`.
      return [
        {
          dir: `${project.testProjectName}/PageObjects/Selectors`,
          fileFilter: (n) => n.endsWith("Selectors.cs"),
          pairRegex:
            /^([ \t]*)public\s+static\s+readonly\s+string\s+(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*;\s*$/gm,
          buildReplacement: (key, val) =>
            `        public static readonly string ${key} = "${escapeForCsharp(val)}";`,
        },
      ];
  }
}

/** Recursively list every regular file under `dirAbs`, ignoring errors. */
async function walkAll(dirAbs: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const child = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      const sub = await walkAll(child);
      out.push(...sub);
    } else if (e.isFile()) {
      out.push(child);
    }
  }
  return out;
}

async function healFilesForProject(
  project: Project,
  oldSel: string,
  newSel: string,
  dryRun: boolean,
): Promise<HealResultFileDetail[]> {
  const out: HealResultFileDetail[] = [];
  const shapes = shapesFor(project);
  for (const shape of shapes) {
    const baseAbs = shape.dir
      ? path.join(project.rootPath, shape.dir)
      : project.rootPath;
    const candidates = await walkAll(baseAbs);
    for (const abs of candidates) {
      if (!shape.fileFilter(path.basename(abs))) continue;
      let raw: string;
      try {
        raw = await fs.readFile(abs, "utf8");
      } catch {
        continue;
      }
      const matchedKeys: string[] = [];
      const sites: HealResultSite[] = [];
      let count = 0;
      // Reset lastIndex on the shared regex before each file scan.
      shape.pairRegex.lastIndex = 0;
      const rewritten = raw.replace(
        shape.pairRegex,
        (
          full: string,
          _indent: string,
          key: string,
          value: string,
          offset: number,
        ) => {
          // Decode common escape sequences before comparing so a
          // selector with literal quotes round-trips correctly.
          const decoded = value
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
          if (decoded !== oldSel) return full;
          matchedKeys.push(key);
          count++;
          const after = shape.buildReplacement(key, newSel);
          // Compute the 1-based line number from the byte offset so the
          // dialog can show "line N: <before> → <after>" per site.
          const line = raw.slice(0, offset).split("\n").length;
          sites.push({
            location: `line ${line}`,
            before: full,
            after,
          });
          return after;
        },
      );
      if (count === 0) continue;
      out.push({
        filePath: path.relative(project.rootPath, abs),
        keys: matchedKeys,
        replacements: count,
        sites,
      });
      if (!dryRun) {
        try {
          await fs.writeFile(abs, rewritten, "utf8");
        } catch {
          // Heal is best-effort per file — a write failure on one
          // file should not block the others. The (still-present)
          // recorded actions update is the source of truth, and the
          // user can re-finalize the suite to regenerate the
          // selectors file from those actions.
        }
      }
    }
  }
  return out;
}

export async function healSelector(args: {
  userId: string;
  projectName: string;
  oldSelector: string;
  newSelector: string;
  dryRun?: boolean;
  /**
   * The user's loaded project, needed for the on-disk Selectors-file
   * pass. Optional so existing callers (or tests) that only want the
   * recorded-actions pass can omit it; when omitted, no files are
   * touched and `fileDetails` is empty.
   */
  project?: Project | null;
}): Promise<HealResult> {
  const rows = await db
    .select()
    .from(recordedActionSetsTable)
    .where(
      and(
        eq(recordedActionSetsTable.userId, args.userId),
        eq(recordedActionSetsTable.projectName, args.projectName),
      ),
    );
  const details: HealResultDetail[] = [];
  let total = 0;
  for (const row of rows) {
    const actions = (row.actions as RecordedAction[]) ?? [];
    const { changed, count, next, sites } = rewriteActions(
      actions,
      args.oldSelector,
      args.newSelector,
    );
    if (!changed) continue;
    total += count;
    details.push({
      filePath: row.filePath,
      kind: row.kind,
      methodName: row.methodName ?? null,
      replacements: count,
      sites,
    });
    if (!args.dryRun) {
      await db
        .update(recordedActionSetsTable)
        .set({ actions: next, updatedAt: new Date() })
        .where(eq(recordedActionSetsTable.id, row.id));
    }
  }
  const fileDetails = args.project
    ? await healFilesForProject(
        args.project,
        args.oldSelector,
        args.newSelector,
        args.dryRun === true,
      )
    : [];
  const fileTotal = fileDetails.reduce((s, d) => s + d.replacements, 0);
  return {
    oldSelector: args.oldSelector,
    newSelector: args.newSelector,
    totalReplacements: total + fileTotal,
    recordingsChanged: details.length,
    details,
    filesChanged: fileDetails.length,
    fileDetails,
  };
}

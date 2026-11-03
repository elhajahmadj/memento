#!/usr/bin/env tsx
/**
 * Size-budget enforcement (Phase 6 of the Clean Architecture refactor).
 *
 * Budgets (per docs/ARCHITECTURE.md §6):
 *   - React component file (`.tsx`):                 ≤ 200 lines
 *   - Application use case (`**\/application\/useCases\/**\/*.ts`): ≤ 80 lines
 *   - Class file (any other `.ts` containing `class X {`): ≤ 120 lines
 *   - Everything else: no budget
 *
 * Test files (`__tests__/`, `*.test.ts(x)`, `*.spec.ts(x)`) are not gated.
 *
 * Behavior:
 *   - Walks both artifact `src/` trees and `lib/` packages.
 *   - Compares each file's line count to its budget.
 *   - A baseline file (`scripts/size-budget-baseline.json`) records the
 *     known pre-existing over-budget files and their current line
 *     counts. These are treated as documented tech debt and only fail
 *     when they GROW past their baseline number.
 *   - Any new over-budget file (not in baseline) fails the check.
 *   - Run with `--update-baseline` to rewrite the baseline JSON when a
 *     deliberate split changes the set.
 *
 * Wired into `pnpm run build` at the repo root.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const baselinePath = path.join(repoRoot, "scripts", "size-budget-baseline.json");

const ROOTS = [
  "artifacts/api-server/src",
  "artifacts/test-builder/src",
  "lib/kernel/src",
  "lib/db/src",
];

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  ".turbo",
  "__tests__",
  ".replit-artifact",
]);

type Category = "react" | "useCase" | "class";

const BUDGETS: Record<Category, number> = {
  react: 200,
  useCase: 80,
  class: 120,
};

interface Finding {
  file: string;
  category: Category;
  lines: number;
  budget: number;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIR_NAMES.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, out);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
}

function isTestFile(rel: string): boolean {
  return (
    /\.(test|spec)\.tsx?$/.test(rel) ||
    rel.includes("/__tests__/") ||
    rel.includes("/test-helpers/")
  );
}

async function categorize(absFile: string, rel: string): Promise<Category | null> {
  if (rel.endsWith(".tsx")) return "react";
  if (!rel.endsWith(".ts")) return null;
  if (rel.endsWith(".d.ts")) return null;

  if (/\/application\/useCases\//.test(rel)) return "useCase";

  // Class file? Only flag when the file actually declares a class.
  const content = await fs.readFile(absFile, "utf8");
  if (/^\s*(export\s+)?(abstract\s+)?class\s+\w/m.test(content)) return "class";

  return null;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  // Don't count a trailing newline as an extra blank line.
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  return trimmed.split("\n").length;
}

interface Baseline {
  /** rel-path -> recorded line count at baseline. */
  files: Record<string, number>;
}

async function loadBaseline(): Promise<Baseline> {
  try {
    const raw = await fs.readFile(baselinePath, "utf8");
    const parsed = JSON.parse(raw) as Baseline;
    return { files: parsed.files ?? {} };
  } catch {
    return { files: {} };
  }
}

async function writeBaseline(b: Baseline): Promise<void> {
  const sorted: Baseline = { files: {} };
  for (const k of Object.keys(b.files).sort()) sorted.files[k] = b.files[k];
  await fs.writeFile(baselinePath, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

async function collectFindings(): Promise<Finding[]> {
  const files: string[] = [];
  for (const root of ROOTS) {
    await walk(path.join(repoRoot, root), files);
  }

  const findings: Finding[] = [];
  for (const abs of files) {
    const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
    if (isTestFile(rel)) continue;
    const category = await categorize(abs, rel);
    if (!category) continue;
    const content = await fs.readFile(abs, "utf8");
    const lines = countLines(content);
    const budget = BUDGETS[category];
    if (lines > budget) {
      findings.push({ file: rel, category, lines, budget });
    }
  }
  findings.sort((a, b) => b.lines - a.lines);
  return findings;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const update = args.has("--update-baseline");

  const findings = await collectFindings();
  const baseline = await loadBaseline();

  if (update) {
    const next: Baseline = { files: {} };
    for (const f of findings) next.files[f.file] = f.lines;
    await writeBaseline(next);
    console.log(
      `[size-budgets] Wrote baseline of ${findings.length} over-budget files to ${path.relative(repoRoot, baselinePath)}.`,
    );
    return;
  }

  const newViolations: Finding[] = [];
  const grown: Array<Finding & { baseline: number }> = [];
  for (const f of findings) {
    const baselineCount = baseline.files[f.file];
    if (baselineCount === undefined) {
      newViolations.push(f);
    } else if (f.lines > baselineCount) {
      grown.push({ ...f, baseline: baselineCount });
    }
  }

  if (newViolations.length === 0 && grown.length === 0) {
    const baselined = Object.keys(baseline.files).length;
    console.log(
      `[size-budgets] OK — ${findings.length} baselined over-budget file(s) unchanged, no new violations. (Tracked tech debt: ${baselined}.)`,
    );
    return;
  }

  console.error("[size-budgets] FAIL\n");
  if (newViolations.length > 0) {
    console.error(`New files exceeding size budgets (${newViolations.length}):`);
    for (const f of newViolations) {
      console.error(
        `  - ${f.file}  (${f.lines} lines, budget ${f.budget} for ${f.category})`,
      );
    }
    console.error(
      "\n  Split these files into smaller, single-responsibility modules.",
    );
    console.error(
      "  If a split is genuinely impractical, rerun with `pnpm --filter @workspace/scripts run check-size-budgets -- --update-baseline` and document the addition in docs/REFACTORING_PLAN.md.\n",
    );
  }
  if (grown.length > 0) {
    console.error(`Baselined files that grew past their recorded size (${grown.length}):`);
    for (const f of grown) {
      console.error(
        `  - ${f.file}  ${f.baseline} -> ${f.lines} (budget ${f.budget})`,
      );
    }
    console.error(
      "\n  These files are already tracked as tech debt; please don't make them worse. Shrink them, or split out the new code.\n",
    );
  }
  process.exit(1);
}

await main();

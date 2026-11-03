import type { TestKind, TestTotals } from "./types";

const E2E_TAGS = new Set(["e2e", "end-to-end", "endtoend"]);
const API_TAGS = new Set(["api"]);
const UNIT_TAGS = new Set(["unit"]);

function normalizeTag(t: string): string {
  return t.trim().toLowerCase().replace(/^@+/, "");
}

/**
 * Classify a single test method.
 *
 * Rules (per OpenAPI spec):
 *  - Tag/attribute on the method (or its enclosing class) wins.
 *  - Otherwise, folder convention: any path segment named `e2e/` →
 *    `e2e`; `api/` → `api`; default `unit`.
 *  - Tag/attribute *override* folder placement.
 */
export function classifyMethod(args: {
  /** Project-relative POSIX path of the file. */
  filePath: string;
  /** Tags from method + enclosing class merged together. */
  tags: ReadonlyArray<string>;
  /**
   * Project-level default kind. Used as the final fallback when no
   * tag/attribute and no folder convention matches. Lets a Playwright
   * UI solution's untagged tests classify as `e2e` (the natural default
   * for that project shape) instead of always falling to `unit`. When
   * unspecified, falls back to `unit` to preserve legacy behavior.
   */
  defaultKind?: TestKind;
}): TestKind {
  const tags = args.tags.map(normalizeTag);
  for (const t of tags) {
    if (E2E_TAGS.has(t)) return "e2e";
    if (API_TAGS.has(t)) return "api";
    if (UNIT_TAGS.has(t)) return "unit";
  }
  const segments = args.filePath.split("/").map((s) => s.toLowerCase());
  if (segments.includes("e2e")) return "e2e";
  if (segments.includes("api")) return "api";
  // Recorder convention: the C# API test scaffolder emits its tests
  // under `{Solution}.Automation.API.Tests/Tests/*.cs`. The literal
  // `api/` segment never matches that path, so also bucket anything
  // whose path contains a segment ending in `.api.tests` as `api`.
  if (segments.some((s) => s.endsWith(".api.tests"))) return "api";
  if (segments.some((s) => s.endsWith(".unit.tests") || s.endsWith(".unittests"))) return "unit";
  if (
    segments.some(
      (s) =>
        s.endsWith(".uxtests") ||
        s.endsWith(".ux.tests") ||
        s.endsWith(".ui.tests") ||
        s.endsWith(".uitests"),
    )
  ) {
    return "e2e";
  }
  return args.defaultKind ?? "unit";
}

export function emptyTotals(): TestTotals {
  return { e2e: 0, unit: 0, api: 0, all: 0 };
}

export function bumpTotals(totals: TestTotals, kind: TestKind): void {
  totals[kind] += 1;
  totals.all += 1;
}

export function addTotals(into: TestTotals, from: TestTotals): void {
  into.e2e += from.e2e;
  into.unit += from.unit;
  into.api += from.api;
  into.all += from.all;
}

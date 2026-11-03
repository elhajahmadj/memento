import type { ValidationRunDto } from "@workspace/api-client-react";

/** How many runs the per-test pass-rate metric averages over. */
export const PASS_RATE_WINDOW = 10;

/**
 * Trend window for the per-test summary section. Runs older than this
 * are excluded from the pass-rate / flakiness aggregates so the
 * dashboard reflects current health, not noise from stale runs.
 */
export const TREND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Page size for the run history table at the top of the dashboard. */
export const HISTORY_PAGE_SIZE = 20;

export interface RunStep {
  index: number;
  type: string;
  selector: string | null;
  value: string | null;
  status: "pending" | "passed" | "failed" | "skipped" | "running";
  durationMs: number | null;
  error: string | null;
  assertKind?: string | null;
}

export interface RunSummary {
  steps?: RunStep[];
  failureMessage?: string | null;
  finalScreenshot?: string | null;
  traceFile?: string | null;
  durationMs?: number;
  error?: string;
  // Parent-of-all run aggregate fields.
  passedChildren?: number;
  failedChildren?: number;
  erroredChildren?: number;
  plannedChildren?: number;
}

export interface GroupSummary {
  key: string;
  filePath: string;
  methodName: string | null;
  kind: ValidationRunDto["recordingKind"];
  windowRuns: ValidationRunDto[];
  finishedInWindow: number;
  passesInWindow: number;
  failsInWindow: number;
  passRate: number;
  /**
   * Status-flip rate over the window: how often consecutive finished
   * runs disagree on outcome. 0 = perfectly stable (all pass or all
   * fail), 1 = alternates every run. Distinct from `passRate` because
   * a test that fails consistently has 0% flakiness even at 0% pass.
   */
  flakiness: number;
  latest: ValidationRunDto;
}

export function fmtDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function fmtRelative(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  const ms = now - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return d.toLocaleString();
}

export function recordingLabel(r: ValidationRunDto): string {
  if (!r.recordingFilePath) return "(all tests)";
  const file = r.recordingFilePath.split("/").pop() ?? r.recordingFilePath;
  if (r.recordingMethodName) return `${file} › ${r.recordingMethodName}`;
  return file;
}

export function groupKeyFor(r: ValidationRunDto): string {
  return `${r.recordingFilePath ?? "<all>"}::${r.recordingMethodName ?? ""}`;
}

export function describeStep(s: RunStep): string {
  if (s.type === "navigate") {
    return `navigate ${s.value ?? ""}`.trim();
  }
  if (s.type === "assert") {
    const kind = s.assertKind ?? "assert";
    if (s.selector && s.value) return `assert (${kind}) ${s.selector} → ${s.value}`;
    if (s.value) return `assert (${kind}) ${s.value}`;
    if (s.selector) return `assert (${kind}) ${s.selector}`;
    return `assert (${kind})`;
  }
  if (s.value) return `${s.type} ${s.selector ?? ""} ↳ ${s.value}`.trim();
  if (s.selector) return `${s.type} ${s.selector}`;
  return s.type;
}

export function summarizeByTest(
  runs: ValidationRunDto[],
  now: number = Date.now(),
): GroupSummary[] {
  const cutoff = now - TREND_WINDOW_MS;
  // Skip the parent-of-all rows when computing per-test trends — those
  // aren't a single test, they're a batch wrapper. Also exclude runs
  // older than the trend window so the dashboard reflects current
  // health rather than archived noise.
  const filtered = runs.filter(
    (r) =>
      !r.parentRunId &&
      r.recordingFilePath &&
      new Date(r.queuedAt).getTime() >= cutoff,
  );
  const map = new Map<string, ValidationRunDto[]>();
  for (const r of filtered) {
    const k = groupKeyFor(r);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  const out: GroupSummary[] = [];
  for (const [key, list] of map) {
    // Newest first (the API already returns desc by queuedAt, but be defensive).
    list.sort(
      (a, b) =>
        new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime(),
    );
    const window = list.slice(0, PASS_RATE_WINDOW);
    const finished = window.filter(
      (r) => r.status === "passed" || r.status === "failed" || r.status === "error",
    );
    const passes = finished.filter((r) => r.status === "passed").length;
    const fails = finished.length - passes;
    const passRate = finished.length === 0 ? 1 : passes / finished.length;
    // Status-flip rate. We walk only finished runs (queued/running
    // would otherwise inflate the denominator) and count adjacent
    // outcome changes.
    let flips = 0;
    for (let i = 1; i < finished.length; i++) {
      const a = finished[i - 1]!.status;
      const b = finished[i]!.status;
      const aPass = a === "passed";
      const bPass = b === "passed";
      if (aPass !== bPass) flips += 1;
    }
    const flakiness =
      finished.length > 1 ? flips / (finished.length - 1) : 0;
    const latest = list[0]!;
    out.push({
      key,
      filePath: latest.recordingFilePath ?? "(unknown)",
      methodName: latest.recordingMethodName,
      kind: latest.recordingKind,
      windowRuns: window,
      finishedInWindow: finished.length,
      passesInWindow: passes,
      failsInWindow: fails,
      passRate,
      flakiness,
      latest,
    });
  }
  // Most-recently-touched test first.
  return out.sort(
    (a, b) =>
      new Date(b.latest.queuedAt).getTime() -
      new Date(a.latest.queuedAt).getTime(),
  );
}

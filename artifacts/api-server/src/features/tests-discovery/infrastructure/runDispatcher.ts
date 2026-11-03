import { randomUUID } from "node:crypto";
import {
  spawn as nodeSpawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { User } from "@workspace/db";
import { logger } from "@/shared/logger";

import type { TestLanguage } from "../domain/types";

/**
 * Mirrors the `InternalTestRun` shape from `internalTestRunService` so
 * the UI can reuse the existing run-detail surface for selection-based
 * runs without a parallel contract.
 */
export interface SelectionTestRun {
  id: string;
  suiteKey: "selection";
  suiteName: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "passed" | "failed" | "error";
  exitCode: number | null;
  summary: null;
  errorMessage: string | null;
  startedBy: { id: string; username: string };
  /**
   * The project (slnPath) this run was dispatched against. Used by the
   * `GET .../runs/by-selection/:runId` route to enforce that a run id
   * is only readable through its own project's URL — without this an
   * attacker who learned a run id could read it through any project
   * they happen to be authorized for.
   */
  projectKey: string;
  /**
   * Captured CLI stdout, truncated to {@link OUTPUT_CAP_BYTES}. Surfaced
   * to the run-detail UI so SDETs can read compile errors and assertion
   * failures from `dotnet test` / `pytest` / `playwright test` without
   * digging through server logs.
   */
  stdout: string;
  /** Captured CLI stderr, truncated to {@link OUTPUT_CAP_BYTES}. */
  stderr: string;
}

/**
 * Hard cap on captured stdout/stderr per stream. Picks a generous size
 * (256 KB) — large enough to keep an xUnit failure trace + a compile
 * error wall in full, small enough that a runaway test loop can't
 * exhaust server memory.
 */
export const OUTPUT_CAP_BYTES = 256 * 1024;

export interface SelectionRunGroup {
  language: TestLanguage;
  run: SelectionTestRun;
  testIds: string[];
}

/* ------------------------------------------------------------------ */
/* Pure helpers — CLI argv builders. Exported for unit tests so we can */
/* assert the exact invocation per language without spawning anything. */
/* ------------------------------------------------------------------ */

/** Escape a string for use inside a JS regex literal (Playwright `--grep`). */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface CliInvocation {
  command: string;
  args: string[];
  /** Working directory the runner should be spawned in. */
  cwd: string;
}

export function buildCSharpInvocation(args: {
  rootPath: string;
  testIds: string[];
}): CliInvocation {
  const filter = args.testIds
    .map((id) => `FullyQualifiedName=${id}`)
    .join("|");
  return {
    command: "dotnet",
    args: ["test", "--filter", filter, "--nologo"],
    cwd: args.rootPath,
  };
}

export function buildPythonInvocation(args: {
  rootPath: string;
  testIds: string[];
}): CliInvocation {
  // Pytest accepts node ids directly: `path/to/file.py::Class::method`.
  return {
    command: "pytest",
    args: [...args.testIds],
    cwd: args.rootPath,
  };
}

export function buildNodeJsInvocation(args: {
  rootPath: string;
  testIds: string[];
}): CliInvocation {
  // Node.js (Playwright) ids look like `tests/foo.spec.ts > describe > test`.
  // Group selections by file path so we can scope `--grep` correctly.
  const byFile = new Map<string, string[]>();
  for (const id of args.testIds) {
    const sep = id.indexOf(" > ");
    if (sep === -1) continue;
    const file = id.slice(0, sep);
    const titlePath = id.slice(sep + 3);
    const arr = byFile.get(file) ?? [];
    arr.push(titlePath);
    byFile.set(file, arr);
  }
  const grepParts: string[] = [];
  const filePaths: string[] = [];
  for (const [file, titles] of byFile) {
    filePaths.push(file);
    grepParts.push(...titles.map(escapeRegex));
  }
  const grep = grepParts.length > 0 ? `(${grepParts.join("|")})` : "";
  const out: string[] = ["playwright", "test", ...filePaths];
  if (grep.length > 0) out.push("--grep", grep);
  return {
    command: "npx",
    args: out,
    cwd: args.rootPath,
  };
}

export function buildJavaInvocation(args: {
  rootPath: string;
  testIds: string[];
}): CliInvocation {
  // `gradle test --tests "com.pkg.Class.method"` (gradle uses `.` not `#`).
  const isMaven = args.rootPath
    ? existsSync(path.join(args.rootPath, "pom.xml"))
    : false;
  const normalized = args.testIds.map((id) => id.replace("#", "."));
  if (isMaven) {
    return {
      command: "mvn",
      args: ["-q", "test", `-Dtest=${normalized.join(",")}`],
      cwd: args.rootPath,
    };
  }
  return {
    command: "gradle",
    args: ["test", ...normalized.flatMap((t) => ["--tests", t])],
    cwd: args.rootPath,
  };
}

export function buildInvocation(
  language: TestLanguage,
  args: { rootPath: string; testIds: string[] },
): CliInvocation {
  switch (language) {
    case "csharp":
      return buildCSharpInvocation(args);
    case "python":
      return buildPythonInvocation(args);
    case "nodejs":
      return buildNodeJsInvocation(args);
    case "java":
      return buildJavaInvocation(args);
  }
}

/* ------------------------------------------------------------------ */
/* Dispatcher — groups ids by language, spawns one CLI per group, and */
/* tracks an in-memory `SelectionTestRun` record per group.           */
/* ------------------------------------------------------------------ */

/**
 * Decide which language an opaque test id belongs to.
 *
 *  - C#:     `Namespace.Class.Method` (no slashes, no spaces, no `#`,
 *            no `::`).
 *  - Python: contains `.py::`.
 *  - Node.js: contains ` > ` (the describe/test separator).
 *  - Java:   contains `#` (`com.pkg.Class#method`).
 *
 * Order matters — Python/Node.js/Java markers are checked before the
 * C# fallback so an id with `::` doesn't get mis-routed to dotnet.
 */
export function languageForTestId(id: string): TestLanguage {
  if (id.includes(".py::") || id.includes(".py")) return "python";
  if (id.includes(" > ")) return "nodejs";
  if (id.includes("#")) return "java";
  return "csharp";
}

export function groupTestIdsByLanguage(
  ids: ReadonlyArray<string>,
): Map<TestLanguage, string[]> {
  const out = new Map<TestLanguage, string[]>();
  for (const id of ids) {
    const lang = languageForTestId(id);
    const arr = out.get(lang) ?? [];
    arr.push(id);
    out.set(lang, arr);
  }
  return out;
}

export type SelectionSpawnImpl = (
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

let spawnImpl: SelectionSpawnImpl = nodeSpawn as unknown as SelectionSpawnImpl;

/** Test seam — replace the spawn implementation. */
export function __setSelectionSpawnImplForTesting(
  fn: SelectionSpawnImpl | null,
): void {
  spawnImpl = fn ?? (nodeSpawn as unknown as SelectionSpawnImpl);
}

const SELECTION_RUNS = new Map<string, SelectionTestRun>();

export function getSelectionRun(id: string): SelectionTestRun | null {
  return SELECTION_RUNS.get(id) ?? null;
}

/** Test-only — drop all in-memory state. */
export function __resetSelectionRunsForTesting(): void {
  SELECTION_RUNS.clear();
}

export function dispatchSelectionRun(args: {
  language: TestLanguage;
  rootPath: string;
  testIds: string[];
  user: Pick<User, "id" | "username">;
  /**
   * Stable per-project key (the canonical `slnPath`) used to scope the
   * resulting run id. The `GET .../by-selection/:runId` route refuses
   * to return a run whose `projectKey` doesn't match the URL's
   * project. Optional for backwards compatibility with callers that
   * predate the scope check (older tests); routes always pass it.
   */
  projectKey?: string;
}): SelectionTestRun {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const run: SelectionTestRun = {
    id,
    suiteKey: "selection",
    suiteName: `Selection (${args.language}, ${args.testIds.length} tests)`,
    startedAt,
    finishedAt: null,
    status: "running",
    exitCode: null,
    summary: null,
    errorMessage: null,
    startedBy: { id: args.user.id, username: args.user.username },
    projectKey: args.projectKey ?? args.rootPath,
    stdout: "",
    stderr: "",
  };
  SELECTION_RUNS.set(id, run);

  const inv = buildInvocation(args.language, {
    rootPath: args.rootPath,
    testIds: args.testIds,
  });

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnImpl(inv.command, inv.args, {
      cwd: inv.cwd,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "1" },
    });
  } catch (err) {
    run.status = "error";
    run.errorMessage = err instanceof Error ? err.message : String(err);
    run.finishedAt = new Date().toISOString();
    logger.error(
      { err, language: args.language, command: inv.command },
      "Failed to spawn selection-run CLI",
    );
    return run;
  }

  child.on("error", (err) => {
    if (run.status !== "running") return;
    run.errorMessage = err.message;
  });
  child.on("close", (code) => {
    if (run.status !== "running") return;
    run.exitCode = code ?? null;
    run.status = code === 0 ? "passed" : run.errorMessage ? "error" : "failed";
    run.finishedAt = new Date().toISOString();
  });
  // Capture both stdio streams up to OUTPUT_CAP_BYTES per stream so the
  // run-detail UI can show compile errors, assertion traces, and the
  // dotnet/pytest/playwright failure summary without a separate log
  // tail. Once a stream hits the cap, the rest of that stream is
  // dropped (a single "[truncated]" marker is appended) but data keeps
  // flowing so the child doesn't block on back-pressure.
  const append = (key: "stdout" | "stderr") => (chunk: Buffer | string) => {
    if (run[key].length >= OUTPUT_CAP_BYTES) return;
    const text =
      typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const remaining = OUTPUT_CAP_BYTES - run[key].length;
    if (text.length <= remaining) {
      run[key] += text;
      return;
    }
    run[key] += text.slice(0, remaining) + "\n[truncated]";
  };
  child.stdout?.on("data", append("stdout"));
  child.stderr?.on("data", append("stderr"));

  return run;
}

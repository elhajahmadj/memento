import { randomUUID } from "node:crypto";
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type User } from "@workspace/db";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import { logger } from "@/shared/logger";

export type InternalTestSuiteKey =
  | "all"
  | "arch-projects"
  | "auth"
  | "recording"
  | "recording-mutations"
  | "codegen-assertions"
  | "validation-replay"
  | "frontend-rtl"
  | "shared-steps"
  | "selector-heal"
  | "auth-state-capture"
  | "wait-codegen"
  | "frontend-rtl-tier2"
  | "tier3-mocks"
  | "tier3-codegen"
  | "tier3-frontend";

/** Workspace package the suite's vitest invocation should run inside. */
export type InternalTestSuitePackage =
  | "@workspace/api-server"
  | "@workspace/test-builder";

export interface InternalTestSuiteDescriptor {
  key: InternalTestSuiteKey;
  name: string;
  description: string;
  /**
   * Vitest file paths relative to the package root. An empty list means
   * "run every suite vitest discovers" (used for `all`).
   */
  files: string[];
  /**
   * Which workspace package's vitest is invoked. Defaults to
   * `@workspace/api-server` for backend-side suites; the
   * `frontend-rtl` suite uses `@workspace/test-builder` so the React
   * Testing Library specs registered for /tools/internal-tests can be
   * exercised through the same in-product runner.
   */
  package?: InternalTestSuitePackage;
}

export const INTERNAL_TEST_SUITES: ReadonlyArray<InternalTestSuiteDescriptor> = [
  {
    key: "all",
    name: "All",
    description: "Run every api-server vitest suite.",
    files: [],
  },
  {
    key: "arch-projects",
    name: "Architecture & projects",
    description:
      "Architecture import/export route tests, projectService scaffolding tests, and the architecture builder unit tests.",
    files: [
      "src/features/architectures/presentation/routes/__tests__/architectures.routes.test.ts",
      "src/features/architectures/infrastructure/__tests__/architecture.test.ts",
      "src/features/projects/infrastructure/__tests__/projectService.test.ts",
    ],
  },
  {
    key: "auth",
    name: "Auth routes",
    description: "Cookie session login/logout, /auth/me, profile updates, local-mode flow.",
    files: [
      "src/features/auth/presentation/routes/__tests__/auth.routes.test.ts",
    ],
  },
  {
    key: "recording",
    name: "Recording",
    description:
      "Recording session lifecycle, action store, replay, and the injection-script tests.",
    files: [
      "src/features/recording/infrastructure/__tests__/recordingService.test.ts",
      "src/features/recording/infrastructure/__tests__/recorderInjection.test.ts",
    ],
  },
  {
    key: "recording-mutations",
    name: "Recording action mutations",
    description:
      "WS-handler action-set mutations: move / duplicate / edit-value / delete / undelete / bulk delete+undelete / add+insert assertion, plus their audit calls.",
    files: [
      "src/features/recording/infrastructure/__tests__/recordingActionMutations.test.ts",
    ],
  },
  {
    key: "codegen-assertions",
    name: "Codegen assertion lines",
    description:
      "Per-language renderAssertionLine tests for all nine assertion kinds (C#, Python, Node.js, Java).",
    files: [
      "src/features/codegen/infrastructure/__tests__/csharpCodegen.test.ts",
      "src/features/codegen/infrastructure/__tests__/nodejsCodegen.test.ts",
      "src/features/codegen/infrastructure/__tests__/pythonCodegen.test.ts",
      "src/features/codegen/infrastructure/__tests__/javaCodegen.test.ts",
    ],
  },
  {
    key: "validation-replay",
    name: "Validation replay",
    description:
      "Replay-service integration tests including enqueueValidateAll fan-out (parent recordingKind:'all' + child runs), the fixture-backed end-to-end happy-path against a local HTTP fixture, and the validation routes.",
    files: [
      "src/features/validation/infrastructure/__tests__/replayServiceValidateAll.test.ts",
      "src/features/validation/infrastructure/__tests__/replayServiceValidateAllFixture.test.ts",
      "src/features/validation/presentation/routes/__tests__/validation.routes.test.ts",
    ],
  },
  {
    key: "frontend-rtl",
    name: "Frontend (test-builder) RTL",
    description:
      "React Testing Library specs for the Tier-1 no-code UI: actions feed (drag/move/duplicate + undo toasts), add-assertion dialog (six new assertion kinds + payload shaping), and the /tools/test-runs panel (sparklines, drilldown, parent-of-all aggregate counts).",
    package: "@workspace/test-builder",
    files: [
      "src/features/workbench/presentation/components/__tests__/actions-feed.test.tsx",
      "src/features/workbench/presentation/dialogs/__tests__/add-assertion-dialog.test.tsx",
      "src/features/tools/presentation/pages/__tests__/tools-test-runs.test.tsx",
    ],
  },
  {
    key: "shared-steps",
    name: "Shared steps (Tier-2 reusability)",
    description:
      "CRUD + role-gating for /api/shared-steps and the WS `insert-shared-step` splice handler that shifts subsequent indices and broadcasts a single actions-resync.",
    files: [
      "src/features/shared-steps/presentation/routes/__tests__/sharedSteps.routes.test.ts",
      "src/features/recording/infrastructure/__tests__/insertSharedStepSplice.test.ts",
    ],
  },
  {
    key: "selector-heal",
    name: "Selector heal (Fix Selector)",
    description:
      "POST /api/selectors/heal cross-recording rewrite + per-language Selectors-file rewrite (C#/Python/Node/Java) with dry-run preview vs. apply paths.",
    files: [
      "src/features/selector-heal/presentation/routes/__tests__/selectorHeal.routes.test.ts",
    ],
  },
  {
    key: "auth-state-capture",
    name: "Persisted-login capture/consume",
    description:
      "Capture-mode recording start, /api/auth-state/save persistence with a label, consume-on-recording-start when `useSavedLogin` is set, and consume-on-replay (validation pump hydrates chromium.newContext with the saved storageState).",
    files: [
      "src/features/auth-states/infrastructure/__tests__/authStateCaptureConsume.test.ts",
      "src/features/validation/infrastructure/__tests__/replayServicePersistedLogin.test.ts",
    ],
  },
  {
    key: "wait-codegen",
    name: "Wait codegen (per language)",
    description:
      "Per-language renderWaitLine for selector / networkidle / timeout wait kinds across C#, Python, Node.js, and Java.",
    files: [
      "src/features/codegen/infrastructure/__tests__/waitCodegen.test.ts",
    ],
  },
  {
    key: "frontend-rtl-tier2",
    name: "Frontend Tier-2 RTL (reusability/reliability dialogs)",
    description:
      "React Testing Library specs for the Tier-2 UI: shared-steps Settings section (CRUD + JSON validation), Insert-shared-step picker (append vs splice-after-focused), Fix-selector dialog (preview→apply + Selectors-file list), Capture-login dialog + Start-recording \"Use saved login\" checkbox, and the Add-Wait dialog (selector/networkidle/timeout payloads).",
    package: "@workspace/test-builder",
    files: [
      "src/features/settings/presentation/sections/__tests__/shared-steps-section.test.tsx",
      "src/features/workbench/presentation/dialogs/__tests__/insert-shared-step-dialog.test.tsx",
      "src/features/workbench/presentation/dialogs/__tests__/fix-selector-dialog.test.tsx",
      "src/features/workbench/presentation/dialogs/__tests__/capture-login-dialog.test.tsx",
      "src/features/workbench/presentation/dialogs/__tests__/add-wait-dialog.test.tsx",
      "src/features/workbench/presentation/dialogs/__tests__/start-recording-dialog-saved-login.test.tsx",
    ],
  },
  {
    key: "tier3-mocks",
    name: "Tier 3 — mocks, demo, tour",
    description:
      "Route-mocks CRUD routes + service install order, the demo project endpoint, the onboarding tour endpoints, and the replay install-order guard.",
    files: [
      "src/features/route-mocks/__tests__/route-mocks.routes.test.ts",
      "src/features/route-mocks/__tests__/routeMockService.test.ts",
      "src/features/tour/__tests__/tour.routes.test.ts",
      "src/features/demo/__tests__/demo.routes.test.ts",
      "src/features/validation/infrastructure/__tests__/replayInstallOrder.test.ts",
    ],
  },
  {
    key: "tier3-codegen",
    name: "Tier 3 — per-language codegen",
    description:
      "Snapshot tests for the routeMock / apiAssertion / accessibility / visual-baseline renderers in C#, Node.js, Java and Python.",
    files: [
      "src/features/codegen/infrastructure/__tests__/csharpTier3Codegen.test.ts",
      "src/features/codegen/infrastructure/__tests__/nodejsTier3Codegen.test.ts",
      "src/features/codegen/infrastructure/__tests__/javaTier3Codegen.test.ts",
      "src/features/codegen/infrastructure/__tests__/pythonTier3Codegen.test.ts",
    ],
  },
  {
    key: "tier3-frontend",
    name: "Tier 3 — workbench UI",
    description:
      "RTL tests for the Add API check + Add Assertion (a11y/visual) dialogs, the Settings → Mocks section, the Try-the-demo card, and the onboarding tour.",
    package: "@workspace/test-builder",
    files: [
      "src/features/workbench/presentation/dialogs/__tests__/add-api-check-dialog.test.tsx",
      "src/features/workbench/presentation/dialogs/__tests__/add-assertion-dialog.test.tsx",
      "src/features/settings/presentation/sections/__tests__/mocks-section.test.tsx",
      "src/features/projects/presentation/components/__tests__/demo-card.test.tsx",
      "src/features/onboarding/presentation/__tests__/onboarding-tour.test.tsx",
    ],
  },
];

export type InternalTestRunStatus = "running" | "passed" | "failed" | "error";

export interface InternalTestRunSummary {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTotalTestSuites: number;
  numFailedTestSuites: number;
  durationMs: number;
}

export interface InternalTestRun {
  id: string;
  suiteKey: InternalTestSuiteKey;
  suiteName: string;
  startedAt: string;
  finishedAt: string | null;
  status: InternalTestRunStatus;
  exitCode: number | null;
  summary: InternalTestRunSummary | null;
  errorMessage: string | null;
  startedBy: { id: string; username: string };
}

interface InternalRunRecord extends InternalTestRun {
  log: string[];
  emitter: EventEmitter;
  outputFile: string;
  tmpDir: string;
}

export type InternalTestRunEvent =
  | { type: "log"; line: string }
  | { type: "done"; run: InternalTestRun };

const MAX_LOG_LINES = 5000;

/**
 * Spawn function shape — narrowed to the bits we use, so tests can pass a
 * fake without bringing the whole `node:child_process` typings along.
 */
export type SpawnImpl = (
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

let spawnImpl: SpawnImpl = nodeSpawn as unknown as SpawnImpl;

/** Test seam — replace the spawn implementation. */
export function __setSpawnImplForTesting(fn: SpawnImpl | null): void {
  spawnImpl = fn ?? (nodeSpawn as unknown as SpawnImpl);
}

let workspaceRootOverride: string | null = null;

/** Test seam — pin the workspace root (must contain `pnpm-workspace.yaml`). */
export function __setWorkspaceRootForTesting(root: string | null): void {
  workspaceRootOverride = root;
}

/**
 * Walk up from process.cwd() looking for the pnpm workspace marker. The
 * api-server runs from `artifacts/api-server` in dev (build dir is
 * `dist/`), so the marker lives 2 levels up — but production deploys ship
 * a slimmed bundle that may not include the source tree. When that
 * happens this returns `null` and the entire feature reports
 * `enabled: false` so the UI hides itself instead of 500ing.
 */
function findWorkspaceRoot(): string | null {
  if (workspaceRootOverride !== null) {
    // Test seam: respect the override but still apply the marker check so
    // tests can simulate the "feature disabled" state by pointing the
    // override at a directory without `pnpm-workspace.yaml`.
    if (
      workspaceRootOverride === "" ||
      !existsSync(join(workspaceRootOverride, "pnpm-workspace.yaml"))
    ) {
      return null;
    }
    return workspaceRootOverride;
  }
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      // The api-server package must also be present — otherwise we found
      // some other monorepo's marker and shouldn't claim the feature works.
      if (existsSync(join(dir, "artifacts", "api-server", "package.json"))) {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function isInternalTestRunnerEnabled(): boolean {
  return findWorkspaceRoot() !== null;
}

let currentRun: InternalRunRecord | null = null;
let lastRun: InternalRunRecord | null = null;

function snapshot(record: InternalRunRecord): InternalTestRun {
  return {
    id: record.id,
    suiteKey: record.suiteKey,
    suiteName: record.suiteName,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    status: record.status,
    exitCode: record.exitCode,
    summary: record.summary,
    errorMessage: record.errorMessage,
    startedBy: record.startedBy,
  };
}

export function getCurrentRun(): InternalTestRun | null {
  return currentRun ? snapshot(currentRun) : null;
}

export function getRun(id: string): { run: InternalTestRun; log: string[] } | null {
  const record = currentRun?.id === id ? currentRun : lastRun?.id === id ? lastRun : null;
  if (!record) return null;
  return { run: snapshot(record), log: [...record.log] };
}

export interface SubscribeOptions {
  /** Called with every backlog line before live streaming begins. */
  onBacklog: (lines: string[]) => void;
  /** Called when a new log line arrives or the run finishes. */
  onEvent: (event: InternalTestRunEvent) => void;
}

export function subscribeToRun(id: string, opts: SubscribeOptions): (() => void) | null {
  const record = currentRun?.id === id ? currentRun : lastRun?.id === id ? lastRun : null;
  if (!record) return null;
  opts.onBacklog([...record.log]);
  if (record.status !== "running") {
    // Already done — fire the terminal event immediately so the client
    // doesn't hang waiting for something that already happened.
    opts.onEvent({ type: "done", run: snapshot(record) });
    return () => undefined;
  }
  const handler = (event: InternalTestRunEvent) => opts.onEvent(event);
  record.emitter.on("event", handler);
  return () => record.emitter.off("event", handler);
}

export class InternalTestRunInProgressError extends Error {
  constructor(public readonly run: InternalTestRun) {
    super("Another internal test run is already in progress.");
    this.name = "InternalTestRunInProgressError";
  }
}

export class InternalTestRunnerDisabledError extends Error {
  constructor() {
    super(
      "Internal test runner is disabled (workspace source tree not available).",
    );
    this.name = "InternalTestRunnerDisabledError";
  }
}

function appendLog(record: InternalRunRecord, line: string): void {
  record.log.push(line);
  if (record.log.length > MAX_LOG_LINES) {
    record.log.splice(0, record.log.length - MAX_LOG_LINES);
  }
  record.emitter.emit("event", { type: "log", line } satisfies InternalTestRunEvent);
}

function streamLines(
  stream: NodeJS.ReadableStream,
  prefix: string,
  record: InternalRunRecord,
): void {
  let buffer = "";
  stream.setEncoding?.("utf8");
  stream.on("data", (chunk: string | Buffer) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let idx = buffer.indexOf("\n");
    while (idx !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      appendLog(record, prefix ? `${prefix}${line}` : line);
      idx = buffer.indexOf("\n");
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      appendLog(record, prefix ? `${prefix}${buffer}` : buffer);
      buffer = "";
    }
  });
}

interface VitestJsonReport {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTotalTestSuites?: number;
  numFailedTestSuites?: number;
  startTime?: number;
  // Vitest 4 emits `endTime` and the per-test timestamps; we only need the
  // top-level counts and the duration to render the summary chips.
}

function parseSummary(record: InternalRunRecord): InternalTestRunSummary | null {
  try {
    if (!existsSync(record.outputFile)) return null;
    const raw = readFileSync(record.outputFile, "utf8");
    const json = JSON.parse(raw) as VitestJsonReport;
    const start = typeof json.startTime === "number" ? json.startTime : Date.parse(record.startedAt);
    const end = Date.now();
    return {
      numTotalTests: json.numTotalTests ?? 0,
      numPassedTests: json.numPassedTests ?? 0,
      numFailedTests: json.numFailedTests ?? 0,
      numPendingTests: json.numPendingTests ?? 0,
      numTotalTestSuites: json.numTotalTestSuites ?? 0,
      numFailedTestSuites: json.numFailedTestSuites ?? 0,
      durationMs: Math.max(0, end - start),
    };
  } catch (err) {
    logger.warn({ err }, "Failed to parse vitest JSON summary");
    return null;
  }
}

function cleanupTmp(record: InternalRunRecord): void {
  try {
    rmSync(record.tmpDir, { recursive: true, force: true });
  } catch (err) {
    logger.warn({ err, tmpDir: record.tmpDir }, "Failed to clean up vitest tmp dir");
  }
}

export interface StartRunInput {
  suiteKey: InternalTestSuiteKey;
  user: Pick<User, "id" | "username">;
}

export function startRun({ suiteKey, user }: StartRunInput): InternalTestRun {
  const root = findWorkspaceRoot();
  if (!root) {
    throw new InternalTestRunnerDisabledError();
  }
  if (currentRun && currentRun.status === "running") {
    throw new InternalTestRunInProgressError(snapshot(currentRun));
  }
  const suite = INTERNAL_TEST_SUITES.find((s) => s.key === suiteKey);
  if (!suite) {
    throw new Error(`Unknown internal test suite: ${suiteKey}`);
  }

  const id = randomUUID();
  const tmpDir = mkdtempSync(join(tmpdir(), `vitest-internal-run-${id.slice(0, 8)}-`));
  const outputFile = join(tmpDir, "summary.json");
  const startedAt = new Date().toISOString();

  const record: InternalRunRecord = {
    id,
    suiteKey,
    suiteName: suite.name,
    startedAt,
    finishedAt: null,
    status: "running",
    exitCode: null,
    summary: null,
    errorMessage: null,
    startedBy: { id: user.id, username: user.username },
    log: [],
    emitter: new EventEmitter(),
    outputFile,
    tmpDir,
  };
  // Allow many SSE subscribers without Node's default 10-listener warning.
  record.emitter.setMaxListeners(0);

  currentRun = record;

  appendLog(record, `▶ Starting ${suite.name} (run ${id})`);
  appendLog(
    record,
    suite.files.length === 0
      ? "  Suite: all (no file filter)"
      : `  Files: ${suite.files.join(", ")}`,
  );

  void recordAudit({
    user: { id: user.id },
    action: "internal_test_run_start",
    details: {
      runId: id,
      suiteKey,
      suiteName: suite.name,
      files: suite.files,
    },
  });

  const args = [
    "--filter",
    suite.package ?? "@workspace/api-server",
    "exec",
    "vitest",
    "run",
    ...suite.files,
    "--reporter=default",
    "--reporter=json",
    `--outputFile=${outputFile}`,
  ];

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnImpl("pnpm", args, {
      cwd: root,
      env: {
        ...process.env,
        // Keep vitest's color codes out of our captured log so the SSE
        // payload stays plain ASCII (the UI renders it in a <pre>).
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        CI: "1",
      },
    });
  } catch (err) {
    record.status = "error";
    record.finishedAt = new Date().toISOString();
    record.errorMessage = err instanceof Error ? err.message : String(err);
    appendLog(record, `✖ Failed to spawn vitest: ${record.errorMessage}`);
    finalize(record, user, suite);
    return snapshot(record);
  }

  streamLines(child.stdout, "", record);
  streamLines(child.stderr, "[stderr] ", record);

  child.on("error", (err) => {
    if (record.status !== "running") return;
    record.errorMessage = err.message;
    appendLog(record, `✖ Process error: ${err.message}`);
  });

  child.on("close", (code) => {
    if (record.status !== "running") return;
    record.exitCode = code ?? null;
    record.summary = parseSummary(record);
    if (code === 0) {
      record.status = "passed";
    } else if (record.summary && record.summary.numFailedTests > 0) {
      record.status = "failed";
    } else if (record.errorMessage) {
      record.status = "error";
    } else {
      record.status = "failed";
    }
    record.finishedAt = new Date().toISOString();
    appendLog(
      record,
      `▣ Finished ${suite.name} → ${record.status.toUpperCase()} (exit ${code ?? "null"})`,
    );
    finalize(record, user, suite);
  });

  return snapshot(record);
}

function finalize(
  record: InternalRunRecord,
  user: Pick<User, "id" | "username">,
  suite: InternalTestSuiteDescriptor,
): void {
  const finishedRun = snapshot(record);
  record.emitter.emit("event", { type: "done", run: finishedRun } satisfies InternalTestRunEvent);
  record.emitter.removeAllListeners();
  cleanupTmp(record);
  if (currentRun?.id === record.id) {
    currentRun = null;
  }
  lastRun = record;

  void recordAudit({
    user: { id: user.id },
    action: "internal_test_run_complete",
    details: {
      runId: record.id,
      suiteKey: suite.key,
      suiteName: suite.name,
      status: record.status,
      exitCode: record.exitCode,
      summary: record.summary,
      errorMessage: record.errorMessage,
    },
  });
}

/** Test-only — drop all in-memory state between specs. */
export function __resetForTesting(): void {
  if (currentRun) {
    currentRun.emitter.removeAllListeners();
    cleanupTmp(currentRun);
  }
  if (lastRun && lastRun !== currentRun) {
    cleanupTmp(lastRun);
  }
  currentRun = null;
  lastRun = null;
}

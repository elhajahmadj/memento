import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  __resetForTesting,
  __setSpawnImplForTesting,
  __setWorkspaceRootForTesting,
  getCurrentRun,
  getRun,
  INTERNAL_TEST_SUITES,
  isInternalTestRunnerEnabled,
  startRun,
  subscribeToRun,
  InternalTestRunInProgressError,
  type SpawnImpl,
  type InternalTestRunEvent,
} from "@/features/internal-tests/infrastructure/internalTestRunService";

const recordAuditMock = vi.fn();

vi.mock("@/features/audit/infrastructure/recordAudit", () => ({
  recordAudit: (...args: unknown[]) => recordAuditMock(...args),
}));

interface FakeChild extends EventEmitter {
  stdout: EventEmitter & { setEncoding?: (enc: string) => void };
  stderr: EventEmitter & { setEncoding?: (enc: string) => void };
}

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const stdout = new EventEmitter() as FakeChild["stdout"];
  const stderr = new EventEmitter() as FakeChild["stderr"];
  stdout.setEncoding = () => undefined;
  stderr.setEncoding = () => undefined;
  child.stdout = stdout;
  child.stderr = stderr;
  return child;
}

let workspaceRoot: string;
let summaryFile: string;

const fakeUser = { id: "user-1", username: "alice" };

beforeEach(() => {
  __resetForTesting();
  recordAuditMock.mockReset();
  workspaceRoot = mkdtempSync(join(tmpdir(), "internal-tests-fake-root-"));
  // Real workspace marker so isInternalTestRunnerEnabled() returns true.
  writeFileSync(join(workspaceRoot, "pnpm-workspace.yaml"), "packages:\n");
  // The detector also requires the api-server package.json to exist.
  const apiDir = join(workspaceRoot, "artifacts", "api-server");
  mkdirSync(apiDir, { recursive: true });
  writeFileSync(join(apiDir, "package.json"), "{}");
  __setWorkspaceRootForTesting(workspaceRoot);
  summaryFile = "";
});

afterEach(() => {
  __setSpawnImplForTesting(null);
  __setWorkspaceRootForTesting(null);
  __resetForTesting();
});

describe("internalTestRunService", () => {
  it("reports enabled when the workspace marker is present", () => {
    expect(isInternalTestRunnerEnabled()).toBe(true);
  });

  it("reports disabled when no workspace can be located", () => {
    __setWorkspaceRootForTesting("");
    expect(isInternalTestRunnerEnabled()).toBe(false);
  });

  it("starts a run, captures stdout lines, and finalises on success", async () => {
    const child = makeChild();
    const spawnImpl = vi.fn(() => child) as unknown as SpawnImpl;
    __setSpawnImplForTesting(spawnImpl);

    const run = startRun({ suiteKey: "auth", user: fakeUser });
    expect(run.status).toBe("running");
    expect(run.suiteName).toBe("Auth routes");
    expect(getCurrentRun()?.id).toBe(run.id);

    // Capture the tmp summary file path passed to vitest so we can write
    // a fake JSON report there.
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    const args = (spawnImpl as unknown as { mock: { calls: [string, string[]][] } }).mock
      .calls[0][1];
    const outputArg = args.find((a) => a.startsWith("--outputFile="))!;
    summaryFile = outputArg.replace("--outputFile=", "");
    writeFileSync(
      summaryFile,
      JSON.stringify({
        numTotalTests: 3,
        numPassedTests: 3,
        numFailedTests: 0,
        numPendingTests: 0,
        numTotalTestSuites: 2,
        numFailedTestSuites: 0,
        startTime: Date.now() - 100,
      }),
    );

    const events: InternalTestRunEvent[] = [];
    const unsub = subscribeToRun(run.id, {
      onBacklog: () => undefined,
      onEvent: (evt) => {
        events.push(evt);
      },
    });
    expect(unsub).not.toBeNull();

    child.stdout.emit("data", "RUN  v4.1.4\n");
    child.stdout.emit("data", "Tests passed\n");

    await new Promise<void>((resolve) => {
      const original = events.push.bind(events);
      events.push = ((evt: InternalTestRunEvent) => {
        const result = original(evt);
        if (evt.type === "done") resolve();
        return result;
      }) as typeof events.push;
      child.emit("close", 0);
    });

    const finished = getRun(run.id);
    expect(finished).not.toBeNull();
    expect(finished!.run.status).toBe("passed");
    expect(finished!.run.exitCode).toBe(0);
    expect(finished!.run.summary?.numPassedTests).toBe(3);
    expect(finished!.log.some((l) => l.includes("Tests passed"))).toBe(true);
    // currentRun is cleared once the run finishes.
    expect(getCurrentRun()).toBeNull();
    // Audit fired twice: start + complete.
    expect(recordAuditMock).toHaveBeenCalledTimes(2);
    const actions = recordAuditMock.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(["internal_test_run_start", "internal_test_run_complete"]);
  });

  it("marks a non-zero exit with failed tests as failed", async () => {
    const child = makeChild();
    const spawnImpl = vi.fn(() => child) as unknown as SpawnImpl;
    __setSpawnImplForTesting(spawnImpl);

    const run = startRun({ suiteKey: "recording", user: fakeUser });
    const args = (spawnImpl as unknown as { mock: { calls: [string, string[]][] } }).mock
      .calls[0][1];
    const outputArg = args.find((a) => a.startsWith("--outputFile="))!;
    writeFileSync(
      outputArg.replace("--outputFile=", ""),
      JSON.stringify({
        numTotalTests: 5,
        numPassedTests: 4,
        numFailedTests: 1,
        numPendingTests: 0,
        numTotalTestSuites: 2,
        numFailedTestSuites: 1,
        startTime: Date.now() - 200,
      }),
    );

    child.emit("close", 1);
    // Microtask flush.
    await new Promise((r) => setImmediate(r));

    const finished = getRun(run.id);
    expect(finished?.run.status).toBe("failed");
    expect(finished?.run.summary?.numFailedTests).toBe(1);
  });

  it("rejects a second concurrent run with InternalTestRunInProgressError", () => {
    const child = makeChild();
    __setSpawnImplForTesting(vi.fn(() => child) as unknown as SpawnImpl);

    startRun({ suiteKey: "all", user: fakeUser });

    expect(() => startRun({ suiteKey: "auth", user: fakeUser })).toThrow(
      InternalTestRunInProgressError,
    );
  });

  it("every file registered in INTERNAL_TEST_SUITES exists on disk under its target package", () => {
    // Guard against catalog drift: each suite descriptor's `files`
    // entries are passed straight to `pnpm --filter <pkg> exec vitest
    // run <files...>`. A stale or mistyped path silently runs the
    // remaining files and the "missing" file disappears from the
    // in-product runner without any error — that's exactly how the
    // add-assertion-dialog spec was previously dropped from
    // `frontend-rtl`. This test fails loudly when the catalog points
    // at a path that doesn't exist in the repo.
    const root = join(process.cwd(), "..", ".."); // artifacts/api-server → repo root
    const packageDirs: Record<string, string> = {
      "@workspace/api-server": join(root, "artifacts", "api-server"),
      "@workspace/test-builder": join(root, "artifacts", "test-builder"),
    };
    const missing: string[] = [];
    for (const suite of INTERNAL_TEST_SUITES) {
      if (suite.key === "all") continue; // empty list by design
      const pkg = suite.package ?? "@workspace/api-server";
      const baseDir = packageDirs[pkg];
      expect(baseDir, `unknown suite package: ${pkg}`).toBeDefined();
      for (const rel of suite.files) {
        const abs = join(baseDir!, rel);
        if (!existsSync(abs)) missing.push(`${suite.key} → ${pkg}:${rel}`);
      }
    }
    expect(missing, `missing files registered in INTERNAL_TEST_SUITES: ${missing.join(", ")}`).toEqual([]);
  });

  it("reports status 'error' when spawn itself throws", () => {
    const spawnImpl = vi.fn(() => {
      throw new Error("ENOENT");
    }) as unknown as SpawnImpl;
    __setSpawnImplForTesting(spawnImpl);

    const run = startRun({ suiteKey: "arch-projects", user: fakeUser });
    expect(run.status).toBe("error");
    expect(getCurrentRun()).toBeNull();
    expect(recordAuditMock).toHaveBeenCalledTimes(2);
    expect(recordAuditMock.mock.calls[1][0].action).toBe(
      "internal_test_run_complete",
    );
    expect(recordAuditMock.mock.calls[1][0].details.status).toBe("error");
    // Tmp dir is cleaned up on error too.
    expect(existsSync((run as unknown as { tmpDir?: string }).tmpDir ?? "")).toBe(
      false,
    );
  });
});

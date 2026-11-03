import { describe, it, expect, vi } from "vitest";
import {
  ActiveValidationRunError,
  makeEnqueueValidationRun,
} from "../enqueueValidationRun";
import { makeCancelRunsForSessionToken } from "../cancelRunsForSessionToken";
import { makeRecordReplayResult } from "../recordReplayResult";
import type {
  AuditRecorder,
  ReplayEventBus,
  ValidationRunRepository,
} from "../../ports";

function makeRepoStub(
  over: Partial<ValidationRunRepository> = {},
): ValidationRunRepository {
  return {
    insertQueued: vi.fn().mockResolvedValue({ id: "run-1" }),
    markRunning: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue(null),
    findActiveForProject: vi.fn().mockResolvedValue(null),
    loadSummary: vi.fn().mockResolvedValue(null),
    findBySessionToken: vi.fn().mockResolvedValue([]),
    deleteByIds: vi.fn().mockResolvedValue(undefined),
    listChildrenOf: vi.fn().mockResolvedValue([]),
    loadParentMeta: vi.fn().mockResolvedValue(null),
    updateParentRunning: vi.fn().mockResolvedValue(undefined),
    finishParent: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function makeEventsStub(): ReplayEventBus {
  return {
    push: vi.fn(),
    attach: vi.fn(),
    markDone: vi.fn(),
    isCancelled: vi.fn().mockReturnValue(false),
    markCancelled: vi.fn(),
  };
}

const project = { solutionName: "Demo", namespace: "Demo.QA" } as never;

describe("enqueueValidationRun", () => {
  it("inserts a queued row, emits run-queued, and schedules the entry", async () => {
    const repo = makeRepoStub();
    const events = makeEventsStub();
    const schedule = vi.fn();
    const enqueue = makeEnqueueValidationRun({ repo, events, schedule });

    const id = await enqueue({
      userId: "u1",
      filePath: "Tests/A.cs",
      kind: "testMethod",
      methodName: "T1",
      project,
    });

    expect(id).toBe("run-1");
    expect(repo.findActiveForProject).toHaveBeenCalledWith("Demo");
    expect(repo.insertQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: "Demo",
        recordingFilePath: "Tests/A.cs",
        recordingKind: "testMethod",
        recordingMethodName: "T1",
        triggeredByUserId: "u1",
        summary: {},
      }),
    );
    expect(events.push).toHaveBeenCalledWith("run-1", {
      type: "run-queued",
      runId: "run-1",
    });
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
    );
  });

  it("rejects with ActiveValidationRunError when another run is already active", async () => {
    const repo = makeRepoStub({
      findActiveForProject: vi.fn().mockResolvedValue("active-7"),
    });
    const enqueue = makeEnqueueValidationRun({
      repo,
      events: makeEventsStub(),
      schedule: vi.fn(),
    });
    await expect(
      enqueue({
        userId: "u1",
        filePath: "Tests/A.cs",
        kind: "testMethod",
        methodName: "T1",
        project,
      }),
    ).rejects.toBeInstanceOf(ActiveValidationRunError);
  });

  it("bypasses the active-run guard for child runs (parentRunId set)", async () => {
    const repo = makeRepoStub({
      findActiveForProject: vi.fn().mockResolvedValue("active-7"),
    });
    const enqueue = makeEnqueueValidationRun({
      repo,
      events: makeEventsStub(),
      schedule: vi.fn(),
    });
    await expect(
      enqueue({
        userId: "u1",
        filePath: "Tests/A.cs",
        kind: "testMethod",
        methodName: "T1",
        parentRunId: "parent-1",
        project,
      }),
    ).resolves.toBe("run-1");
    expect(repo.findActiveForProject).not.toHaveBeenCalled();
  });

  it("tags inline-session runs with source + sessionToken in the initial summary", async () => {
    const repo = makeRepoStub();
    const enqueue = makeEnqueueValidationRun({
      repo,
      events: makeEventsStub(),
      schedule: vi.fn(),
    });
    await enqueue({
      userId: "u1",
      filePath: "Tests/Inline.cs",
      kind: "testMethod",
      methodName: "InlineOne",
      project,
      inlineActions: {
        actions: [],
        urlName: "Local",
        startUrl: "http://localhost:9000",
        sessionToken: "tok-xyz",
      },
    });
    expect(repo.insertQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: { source: "session", sessionToken: "tok-xyz" },
      }),
    );
  });
});

describe("cancelRunsForSessionToken", () => {
  it("drains the queue, marks each row done, and deletes the rows", async () => {
    const rows = [
      { id: "r1", status: "queued" as const },
      { id: "r2", status: "running" as const },
    ];
    const repo = makeRepoStub({
      findBySessionToken: vi.fn().mockResolvedValue(rows),
    });
    const events = makeEventsStub();
    const drain = vi.fn();
    const cancel = makeCancelRunsForSessionToken({
      repo,
      events,
      drainQueueForToken: drain,
    });
    const out = await cancel("tok-1", "Demo");
    expect(out.removed).toBe(2);
    expect(drain).toHaveBeenCalledWith("tok-1");
    expect(events.markCancelled).toHaveBeenCalledTimes(2);
    expect(events.markDone).toHaveBeenCalledTimes(2);
    expect(repo.deleteByIds).toHaveBeenCalledWith(["r1", "r2"]);
  });
});

describe("recordReplayResult", () => {
  it("merges sessionToken/source from the prior summary and emits run-finished", async () => {
    const repo = makeRepoStub({
      loadSummary: vi
        .fn()
        .mockResolvedValue({ source: "session", sessionToken: "tok-1" }),
      finish: vi.fn().mockResolvedValue({
        triggeredByUserId: "u1",
        projectName: "Demo",
        recordingFilePath: "Tests/A.cs",
        recordingKind: "testMethod",
        recordingMethodName: "T1",
      }),
    });
    const audit: AuditRecorder = { record: vi.fn().mockResolvedValue(undefined) };
    const events = makeEventsStub();
    const finish = makeRecordReplayResult({ repo, events, audit });
    await finish("r-1", "passed", { traceFile: "r-1.zip" });
    expect(repo.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "r-1",
        status: "passed",
        summary: expect.objectContaining({
          source: "session",
          sessionToken: "tok-1",
          traceFile: "r-1.zip",
        }),
        traceRef: "r-1.zip",
      }),
    );
    expect(events.push).toHaveBeenCalledWith(
      "r-1",
      expect.objectContaining({ type: "run-finished", status: "passed" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "validation_completed" }),
    );
  });
});

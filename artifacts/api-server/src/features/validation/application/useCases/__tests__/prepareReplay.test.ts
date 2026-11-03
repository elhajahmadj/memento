import { describe, it, expect, vi } from "vitest";
import { makePrepareReplay } from "../prepareReplay";
import type {
  AuthStateLoader,
  ReachabilityProbe,
  RecordingLoader,
  ReplayEventBus,
} from "../../ports";

function project() {
  return { solutionName: "Demo", namespace: "Demo.QA" } as never;
}

function events(): ReplayEventBus & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    push: (_id: string, e: unknown) => calls.push(e),
    attach: vi.fn(),
    markDone: vi.fn(),
    isCancelled: vi.fn().mockReturnValue(false),
    markCancelled: vi.fn(),
    calls,
  } as never;
}

function probe(ok: boolean, status = 200, error?: string): ReachabilityProbe {
  return { probe: vi.fn().mockResolvedValue({ ok, status, error }) };
}

function authStates(state: object | null = null): AuthStateLoader {
  return { load: vi.fn().mockResolvedValue(state) };
}

function recordings(
  over: Partial<RecordingLoader> = {},
): RecordingLoader {
  return {
    loadTestMethodActions: vi.fn().mockResolvedValue({
      kind: "testMethod",
      urlName: "Local",
      startUrl: "http://x.test/",
      actions: [],
      methodName: "T1",
    }),
    loadHookActions: vi.fn().mockResolvedValue(null),
    loadHooksForClass: vi.fn().mockResolvedValue({}),
    listRecordingsForUser: vi.fn().mockResolvedValue([]),
    ...over,
  };
}

describe("prepareReplay", () => {
  it("returns ok with a step plan when reachable", async () => {
    const prepare = makePrepareReplay({
      events: events(),
      recordings: recordings(),
      authStates: authStates(),
      reachability: probe(true),
      resolveProject: () => project(),
    });
    const out = await prepare("r1", {
      userId: "u",
      filePath: "Tests/A.cs",
      kind: "testMethod",
      methodName: "T1",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.prepared.steps[0]?.type).toBe("navigate");
    expect(out.prepared.project.solutionName).toBe("Demo");
  });

  it("returns error when no stored recording exists", async () => {
    const prepare = makePrepareReplay({
      events: events(),
      recordings: recordings({
        loadTestMethodActions: vi.fn().mockResolvedValue(null),
      }),
      authStates: authStates(),
      reachability: probe(true),
      resolveProject: () => project(),
    });
    const out = await prepare("r1", {
      userId: "u",
      filePath: "Tests/A.cs",
      kind: "testMethod",
      methodName: "Missing",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(String(out.summary.error)).toMatch(/No stored recording/);
  });

  it("returns error with a helpful message when the start URL is unreachable", async () => {
    const ev = events();
    const prepare = makePrepareReplay({
      events: ev,
      recordings: recordings(),
      authStates: authStates(),
      reachability: probe(false, undefined, "ECONNREFUSED"),
      resolveProject: () => project(),
    });
    const out = await prepare("r1", {
      userId: "u",
      filePath: "Tests/A.cs",
      kind: "testMethod",
      methodName: "T1",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(String(out.summary.error)).toMatch(/not reachable.*C# runner/);
    expect(ev.calls).toContainEqual(
      expect.objectContaining({ type: "preflight", ok: false }),
    );
  });

  it("loads class-level hooks for testMethod runs", async () => {
    const recs = recordings({
      loadHooksForClass: vi
        .fn()
        .mockResolvedValue({
          beforeEach: {
            kind: "beforeEach",
            urlName: "Local",
            startUrl: "http://x.test/",
            actions: [],
            methodName: null,
          },
        }),
    });
    const prepare = makePrepareReplay({
      events: events(),
      recordings: recs,
      authStates: authStates({ cookies: [] }),
      reachability: probe(true),
      resolveProject: () => project(),
    });
    const out = await prepare("r1", {
      userId: "u",
      filePath: "Tests/A.cs",
      kind: "testMethod",
      methodName: "T1",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.prepared.hookSets.beforeEach).toBeDefined();
    expect(out.prepared.storageState).toEqual({ cookies: [] });
    expect(recs.loadHooksForClass).toHaveBeenCalled();
  });

  it("uses inline actions and skips the recording store", async () => {
    const recs = recordings();
    const prepare = makePrepareReplay({
      events: events(),
      recordings: recs,
      authStates: authStates(),
      reachability: probe(true),
      resolveProject: () => project(),
    });
    const out = await prepare("r1", {
      userId: "u",
      filePath: "Tests/Inline.cs",
      kind: "testMethod",
      methodName: "Inline",
      inlineActions: {
        actions: [],
        urlName: "Local",
        startUrl: "http://inline.test/",
        sessionToken: "tok-1",
      },
    });
    expect(out.ok).toBe(true);
    expect(recs.loadTestMethodActions).not.toHaveBeenCalled();
  });
});

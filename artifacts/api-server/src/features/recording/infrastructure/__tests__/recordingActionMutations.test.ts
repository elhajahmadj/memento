/**
 * Locks in the WS-handler action-set mutations exposed by recordingService:
 *
 *   - move-action / duplicate-action / edit-action-value
 *   - delete-action / undelete-action
 *   - delete-actions / undelete-actions (bulk)
 *   - add-assertion (append AND insert-before)
 *
 * For each operation we assert the side effect on the broadcast feed and
 * that `recordAudit` was invoked with the correct `operation` field. The
 * underlying `session.actions` array is private; we therefore observe its
 * shape via the `feedReset` / `actionDeleted` / `actionUndeleted` /
 * `action` broadcast envelopes that every connected socket receives.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => {
  const fillMock = vi.fn().mockResolvedValue(undefined);
  const locatorFirst = { fill: fillMock };
  const locator = vi.fn().mockReturnValue({ first: () => locatorFirst });
  const page = {
    mouse: { click: vi.fn().mockResolvedValue(undefined) },
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
    goto: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    mainFrame: () => ({ url: () => "" }),
    url: vi.fn().mockReturnValue("https://example.com/login"),
    locator,
    screenshot: vi
      .fn()
      .mockImplementation(() => new Promise(() => undefined)),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    exposeBinding: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const recordAudit = vi.fn().mockResolvedValue(undefined);
  return { page, context, browser, fillMock, locator, recordAudit };
});

vi.mock("playwright", () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mocks.browser) },
}));

vi.mock("@/features/audit/infrastructure/recordAudit", () => ({
  recordAudit: mocks.recordAudit,
}));

import {
  setCurrentProject,
  type Project,
} from "@/features/projects/infrastructure/projectService";
import * as recording from "@/features/recording/infrastructure/recordingService";

const TEST_PROJECT = "Acme.Tests";
const NAMESPACE = "Acme";
const REL_TEST_FILE = `${TEST_PROJECT}/Tests/MutateTests.cs`;
const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

const EXISTING_CLASS = `using System.Threading.Tasks;
using NUnit.Framework;
using ${NAMESPACE}.Base;

namespace ${NAMESPACE}.Tests
{
    [TestFixture]
    public class MutateTests : TestFixture
    {
        [Test]
        public async Task Login()
        {
            await Task.CompletedTask;
        }
    }
}
`;

function makeProject(rootPath: string): Project {
  return {
    solutionName: "Acme",
    testProjectName: TEST_PROJECT,
    namespace: NAMESPACE,
    rootPath,
    slnPath: path.join(rootPath, "Acme.sln"),
    language: "csharp",
  };
}

async function scaffoldProject(): Promise<{ tmp: string; project: Project }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-mut-"));
  const project = makeProject(tmp);
  await fs.mkdir(path.join(tmp, TEST_PROJECT, "Tests"), { recursive: true });
  await fs.writeFile(path.join(tmp, REL_TEST_FILE), EXISTING_CLASS);
  await fs.writeFile(
    path.join(tmp, TEST_PROJECT, "appsettings.json"),
    JSON.stringify({ Urls: {} }, null, 2),
  );
  return { tmp, project };
}

async function startSession(): Promise<void> {
  await recording.start(
    {
      startUrl: "https://example.com/login",
      urlName: "Login",
      target: "testMethod",
      methodName: "Login",
      existingTestClassPath: REL_TEST_FILE,
      newTestClassName: null,
    },
    TEST_USER_ID,
  );
}

describe("recordingService — WS-handler action-set mutations", () => {
  let tmp: string;
  let project: Project;
  type Emit = (src: unknown, action: Record<string, unknown>) => void;
  type WsHandler = (raw: string | Buffer) => void | Promise<void>;
  let emit: Emit;
  let wsHandler: WsHandler;
  const sentToWs: string[] = [];

  function fakeWs() {
    sentToWs.length = 0;
    let onMessage: WsHandler | null = null;
    const ws = {
      on: vi.fn((evt: string, cb: WsHandler) => {
        if (evt === "message") onMessage = cb;
      }),
      send: vi.fn((data: string) => {
        sentToWs.push(data);
      }),
      close: vi.fn(),
      readyState: 1,
      OPEN: 1,
    } as unknown as Parameters<typeof recording.attachSocket>[0];
    // attachSocket now requires the authenticated owner id (audit C-2);
  // derive it from the live session so each case stays correct.
  recording.attachSocket(ws, recording.getCurrentSessionOwner()!.userId);
    if (!onMessage) throw new Error("ws message handler not registered");
    wsHandler = onMessage;
    return ws;
  }

  function findLastBroadcast(
    type: string,
  ): Record<string, unknown> | null {
    for (let i = sentToWs.length - 1; i >= 0; i--) {
      const m = JSON.parse(sentToWs[i]!) as Record<string, unknown>;
      if (m.type === type) return m;
    }
    return null;
  }

  function findAuditCall(
    operation: string,
  ): Record<string, unknown> | null {
    for (const call of mocks.recordAudit.mock.calls) {
      const arg = call[0] as { details?: Record<string, unknown> };
      if (arg?.details && arg.details.operation === operation) {
        return arg.details;
      }
    }
    return null;
  }

  async function emitClick(selector: string): Promise<void> {
    emit(null, {
      type: "click",
      selector,
      selectorStrategy: "data-testid",
      url: "https://example.com/login",
    });
    // Let the broadcast settle so the next emit's `index` is sequential.
    await new Promise((r) => setImmediate(r));
  }

  beforeEach(async () => {
    ({ tmp, project } = await scaffoldProject());
    setCurrentProject(project);
    mocks.context.exposeBinding.mockClear();
    mocks.recordAudit.mockClear();
    await startSession();
    const call = mocks.context.exposeBinding.mock.calls.find(
      (c) => c[0] === "__recorderEmit",
    );
    if (!call) throw new Error("__recorderEmit binding never registered");
    emit = call[1] as Emit;
    fakeWs();
  });

  afterEach(async () => {
    await recording.shutdown();
    setCurrentProject(null);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("move-action swaps the row with its visible neighbour and audits {operation:'move-action', from, to, direction}", async () => {
    await emitClick('[data-testid="alpha"]');
    await emitClick('[data-testid="beta"]');
    await emitClick('[data-testid="gamma"]');

    sentToWs.length = 0;
    mocks.recordAudit.mockClear();

    await wsHandler(
      JSON.stringify({ type: "move-action", index: 1, direction: "down" }),
    );

    const reset = findLastBroadcast("feedReset");
    expect(reset).not.toBeNull();
    const rows = reset!.actions as Array<{
      index: number;
      action: { selector?: string };
    }>;
    // After moving index 1 down, beta (index 1) should now sit at index 2
    // and gamma (index 2) should sit at index 1.
    expect(rows[1]?.action.selector).toBe('[data-testid="gamma"]');
    expect(rows[2]?.action.selector).toBe('[data-testid="beta"]');

    const audit = findAuditCall("move-action");
    expect(audit).toMatchObject({
      operation: "move-action",
      from: 1,
      to: 2,
      direction: "down",
    });
  });

  it("duplicate-action splices a copy directly after the source and audits {operation:'duplicate-action', source, inserted}", async () => {
    await emitClick('[data-testid="alpha"]');
    await emitClick('[data-testid="beta"]');

    sentToWs.length = 0;
    mocks.recordAudit.mockClear();

    await wsHandler(
      JSON.stringify({ type: "duplicate-action", index: 0 }),
    );

    const reset = findLastBroadcast("feedReset");
    expect(reset).not.toBeNull();
    const rows = reset!.actions as Array<{ action: { selector?: string } }>;
    expect(rows).toHaveLength(3);
    expect(rows[0]?.action.selector).toBe('[data-testid="alpha"]');
    expect(rows[1]?.action.selector).toBe('[data-testid="alpha"]');
    expect(rows[2]?.action.selector).toBe('[data-testid="beta"]');

    const audit = findAuditCall("duplicate-action");
    expect(audit).toMatchObject({
      operation: "duplicate-action",
      source: 0,
      inserted: 1,
    });
  });

  it("edit-action-value mutates the value field and audits {operation:'edit-action-value', index, field}", async () => {
    emit(null, {
      type: "fill",
      selector: '[data-testid="user"]',
      selectorStrategy: "data-testid",
      value: "old",
      url: "https://example.com/login",
    });
    await new Promise((r) => setImmediate(r));

    sentToWs.length = 0;
    mocks.recordAudit.mockClear();

    await wsHandler(
      JSON.stringify({ type: "edit-action-value", index: 0, value: "new" }),
    );

    const reset = findLastBroadcast("feedReset");
    expect(reset).not.toBeNull();
    const rows = reset!.actions as Array<{ action: { value?: string } }>;
    expect(rows[0]?.action.value).toBe("new");

    const audit = findAuditCall("edit-action-value");
    expect(audit).toMatchObject({
      operation: "edit-action-value",
      index: 0,
      field: "value",
    });
  });

  it("delete-action flags the row deleted and broadcasts actionDeleted", async () => {
    await emitClick('[data-testid="alpha"]');
    await emitClick('[data-testid="beta"]');

    sentToWs.length = 0;

    await wsHandler(
      JSON.stringify({ type: "delete-action", index: 0 }),
    );

    const deleted = findLastBroadcast("actionDeleted");
    expect(deleted).not.toBeNull();
    expect(deleted!.index).toBe(0);
  });

  it("each mutation re-broadcasts a `bodyPreview` envelope so the live test-body preview stays in sync", async () => {
    // Seed a fill at index 0 so edit-action-value (which only accepts
    // editable actions like fill/select/assert-value) has something to
    // mutate, plus two clicks so move/duplicate stay in-bounds.
    emit(null, {
      type: "fill",
      selector: '[data-testid="user"]',
      selectorStrategy: "data-testid",
      value: "old",
      url: "https://example.com/login",
    });
    await new Promise((r) => setImmediate(r));
    await emitClick('[data-testid="beta"]');
    await emitClick('[data-testid="gamma"]');

    type Mutation = { label: string; msg: Record<string, unknown> };
    // Order matters — each mutation must leave the action set in a
    // shape the next mutation can safely target. After move-action
    // 1→down the layout is still [fill@0, click(gamma)@1, click(beta)@2],
    // so duplicate-action 0 produces [fill, fill, click, click] and
    // edit-action-value 0 successfully edits the fill at index 0.
    const mutations: Mutation[] = [
      { label: "move-action", msg: { type: "move-action", index: 1, direction: "down" } },
      { label: "duplicate-action", msg: { type: "duplicate-action", index: 0 } },
      { label: "edit-action-value", msg: { type: "edit-action-value", index: 0, value: "new" } },
      { label: "delete-action", msg: { type: "delete-action", index: 0 } },
      { label: "undelete-action", msg: { type: "undelete-action", index: 0 } },
      {
        label: "add-assertion",
        msg: {
          type: "add-assertion",
          assertKind: "url-contains",
          assertUrl: "/login",
        },
      },
      {
        label: "insert-assertion",
        msg: {
          type: "add-assertion",
          assertKind: "element-visible",
          selector: '[data-testid="banner"]',
          insertBeforeIndex: 0,
        },
      },
    ];

    for (const { label, msg } of mutations) {
      sentToWs.length = 0;
      await wsHandler(JSON.stringify(msg));
      // bodyPreview is fire-and-forget and awaits a real fs.readFile
      // inside — poll briefly instead of pinning a fixed delay so the
      // test stays fast on a hot FS but tolerates a cold one.
      const start = Date.now();
      let preview: Record<string, unknown> | null = null;
      while (Date.now() - start < 1500) {
        preview = findLastBroadcast("bodyPreview");
        if (preview) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(preview, `${label} should broadcast bodyPreview`).not.toBeNull();
      expect(Array.isArray(preview!.lines)).toBe(true);
      expect(Array.isArray(preview!.lineActionIndices)).toBe(true);
    }
  });

  it("rejects messages from a socket attached to no active session (e.g. after shutdown)", async () => {
    // Take a snapshot of the message handler bound to the pre-shutdown
    // session, then tear the session down and replay a mutation. The
    // service should swallow the message — no broadcast, no audit, no
    // throw — because there is nothing to mutate.
    const handler = wsHandler;
    await recording.shutdown();
    sentToWs.length = 0;
    mocks.recordAudit.mockClear();

    await expect(
      handler(JSON.stringify({ type: "delete-action", index: 0 })),
    ).resolves.toBeUndefined();

    expect(sentToWs).toHaveLength(0);
    expect(
      mocks.recordAudit.mock.calls.some(
        (c) =>
          (c[0] as { details?: { operation?: string } })?.details?.operation ===
          "delete-action",
      ),
    ).toBe(false);

    // Re-start a session for the afterEach teardown to find.
    await startSession();
  });

  it("undelete-action restores a previously-deleted row", async () => {
    await emitClick('[data-testid="alpha"]');
    await emitClick('[data-testid="beta"]');
    await wsHandler(
      JSON.stringify({ type: "delete-action", index: 0 }),
    );

    sentToWs.length = 0;

    await wsHandler(
      JSON.stringify({ type: "undelete-action", index: 0 }),
    );

    const undeleted = findLastBroadcast("actionUndeleted");
    expect(undeleted).not.toBeNull();
    expect(undeleted!.index).toBe(0);
    const action = undeleted!.action as { selector?: string };
    expect(action.selector).toBe('[data-testid="alpha"]');
  });

  it("delete-actions bulk-deletes all valid indices and broadcasts an actionDeleted per index", async () => {
    await emitClick('[data-testid="alpha"]');
    await emitClick('[data-testid="beta"]');
    await emitClick('[data-testid="gamma"]');

    sentToWs.length = 0;

    await wsHandler(
      JSON.stringify({ type: "delete-actions", indices: [0, 2] }),
    );

    const deletedIndices = sentToWs
      .map((s) => JSON.parse(s) as Record<string, unknown>)
      .filter((m) => m.type === "actionDeleted")
      .map((m) => m.index as number);
    expect(deletedIndices.sort()).toEqual([0, 2]);
  });

  it("undelete-actions bulk-restores all flagged indices and broadcasts an actionUndeleted per index", async () => {
    await emitClick('[data-testid="alpha"]');
    await emitClick('[data-testid="beta"]');
    await emitClick('[data-testid="gamma"]');
    await wsHandler(
      JSON.stringify({ type: "delete-actions", indices: [0, 2] }),
    );

    sentToWs.length = 0;

    await wsHandler(
      JSON.stringify({ type: "undelete-actions", indices: [0, 2] }),
    );

    const restoredIndices = sentToWs
      .map((s) => JSON.parse(s) as Record<string, unknown>)
      .filter((m) => m.type === "actionUndeleted")
      .map((m) => m.index as number);
    expect(restoredIndices.sort()).toEqual([0, 2]);
  });

  it("add-assertion (append) audits {operation:'add-assertion'} and broadcasts a single 'action' envelope", async () => {
    await emitClick('[data-testid="alpha"]');

    sentToWs.length = 0;
    mocks.recordAudit.mockClear();

    await wsHandler(
      JSON.stringify({
        type: "add-assertion",
        assertKind: "url-contains",
        assertUrl: "/login",
      }),
    );

    const action = findLastBroadcast("action");
    expect(action).not.toBeNull();
    const inner = action!.action as Record<string, unknown>;
    expect(inner.type).toBe("assert");
    expect(inner.assertKind).toBe("url-contains");

    const audit = findAuditCall("add-assertion");
    expect(audit).toMatchObject({
      operation: "add-assertion",
      assertKind: "url-contains",
    });
  });

  it("attachSocket on a stopped session immediately pushes a feedReset snapshot of recorded actions so a refresh / second tab repopulates", async () => {
    // Capture some real actions on the live session.
    await emitClick('[data-testid="alpha"]');
    await emitClick('[data-testid="beta"]');

    // Move the session into the `stopped` phase: the browser is closed but
    // the action list stays mutable so the user can review / save / discard.
    await recording.stopBrowser(recording.getCurrentSessionOwner()!.userId);
    expect(recording.getStatus().phase).toBe("stopped");

    // Simulate a brand-new workbench tab attaching its WebSocket *after*
    // Stop Recording. This is the path used by both real users (refresh)
    // and the doc-screenshot harness — neither has the per-action
    // broadcasts that seeded the original tab's actions feed.
    sentToWs.length = 0;
    fakeWs();
    // Allow any deferred sends (e.g. the body-preview promise chained off
    // of attachSocket) to flush before we inspect the buffer.
    await new Promise((r) => setImmediate(r));

    const reset = findLastBroadcast("feedReset");
    expect(reset).not.toBeNull();
    const rows = reset!.actions as Array<{
      index: number;
      action: { selector?: string; url?: string };
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.action.selector).toBe('[data-testid="alpha"]');
    expect(rows[1]?.action.selector).toBe('[data-testid="beta"]');
    // The url field is what the client uses to seed the canvas header so
    // a reopened stopped session still shows where recording left off.
    expect(rows[1]?.action.url).toBe("https://example.com/login");
  });

  it("add-assertion with insertBeforeIndex splices into the array and audits {operation:'insert-assertion', insertedAt}", async () => {
    await emitClick('[data-testid="alpha"]');
    await emitClick('[data-testid="beta"]');

    sentToWs.length = 0;
    mocks.recordAudit.mockClear();

    await wsHandler(
      JSON.stringify({
        type: "add-assertion",
        assertKind: "element-visible",
        selector: '[data-testid="banner"]',
        insertBeforeIndex: 1,
      }),
    );

    const reset = findLastBroadcast("feedReset");
    expect(reset).not.toBeNull();
    const rows = reset!.actions as Array<{
      action: {
        type?: string;
        assertKind?: string;
        selector?: string;
      };
    }>;
    expect(rows).toHaveLength(3);
    expect(rows[1]?.action.type).toBe("assert");
    expect(rows[1]?.action.assertKind).toBe("element-visible");
    expect(rows[2]?.action.selector).toBe('[data-testid="beta"]');

    const audit = findAuditCall("insert-assertion");
    expect(audit).toMatchObject({
      operation: "insert-assertion",
      assertKind: "element-visible",
      insertedAt: 1,
    });
  });
});

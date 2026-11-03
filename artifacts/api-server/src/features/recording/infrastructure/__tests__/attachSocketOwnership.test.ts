import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Recording WebSocket ownership (audit finding C-2).
 *
 * The regression these tests exist for: `/ws/recording` completed the
 * upgrade with no authentication at all — unlike `/ws/jmx-recording` and
 * `/ws/validation/*`, which both resolved a session user first — and
 * `attachSocket()` checked only that *a* session existed. Because the
 * recording session is a process-wide singleton, any caller who reached
 * the port was attached to whoever happened to be recording: they
 * received the recorded action feed (selectors and the literal values
 * typed into the target app, including credentials) and could send the
 * inbound control messages, which drive a server-side Chromium.
 *
 * The upgrade handler in `index.ts` now authenticates and checks
 * ownership before calling `attachSocket`. These tests cover the
 * defence-in-depth half: `attachSocket` itself refuses a non-owner, and
 * re-checks on every inbound message so a session replaced mid-connection
 * cannot leave a stale socket authorized.
 */

const mocks = vi.hoisted(() => {
  const page = {
    mouse: { click: vi.fn().mockResolvedValue(undefined) },
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
    goto: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    mainFrame: () => ({ url: () => "" }),
    url: vi.fn().mockReturnValue("https://example.com/"),
    locator: vi.fn().mockReturnValue({ first: () => ({ fill: vi.fn() }) }),
    screenshot: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    route: vi.fn().mockResolvedValue(undefined),
    context: vi.fn(),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    exposeBinding: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
    storageState: vi.fn().mockResolvedValue({}),
  };
  page.context = vi.fn().mockReturnValue(context);
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, context, page };
});

vi.mock("playwright", () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mocks.browser) },
}));

import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  createProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import {
  attachSocket,
  getCurrentSessionOwner,
  shutdown,
  start,
} from "@/features/recording/infrastructure/recordingService";

const OWNER = "11111111-1111-1111-1111-111111111111";
const INTRUDER = "22222222-2222-2222-2222-222222222222";

let tmp: string;
let originalWorkspace: string;
let suiteSeq = 0;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-own-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  await shutdown().catch(() => {});
  setCurrentProject(null);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

/** Minimal fake socket that records what was sent and whether it closed. */
function fakeWs() {
  const sent: string[] = [];
  let onMessage: ((raw: string) => void | Promise<void>) | null = null;
  const ws = {
    on: vi.fn((evt: string, cb: (raw: string) => void | Promise<void>) => {
      if (evt === "message") onMessage = cb;
    }),
    send: vi.fn((data: string) => sent.push(data)),
    close: vi.fn(),
    readyState: 1,
    OPEN: 1,
  };
  return {
    ws: ws as unknown as Parameters<typeof attachSocket>[0],
    sent,
    closed: () => ws.close.mock.calls.length > 0,
    deliver: async (msg: unknown) => {
      if (!onMessage) throw new Error("no message handler registered");
      await onMessage(JSON.stringify(msg));
    },
    hasMessageHandler: () => onMessage !== null,
  };
}

async function startOwnedSession(): Promise<void> {
  const name = `SockOwn${++suiteSeq}`;
  const project = await createProject({
    solutionName: name,
    namespace: `${name}.QA`,
  });
  setCurrentProject(project);
  const relSuite = path.join("Tests", `${name}Suite.cs`);
  await fs.mkdir(path.join(project.rootPath, "Tests"), { recursive: true });
  await fs.writeFile(path.join(project.rootPath, relSuite), "// seeded\n");
  await start(
    {
      startUrl: "https://example.com/login",
      urlName: "Login",
      target: "testMethod",
      methodName: "Login",
      existingTestClassPath: relSuite,
      newTestClassName: null,
    },
    OWNER,
  );
}

describe("attachSocket — session ownership", () => {
  it("attaches the session owner", async () => {
    await startOwnedSession();
    expect(getCurrentSessionOwner()?.userId).toBe(OWNER);

    const sock = fakeWs();
    attachSocket(sock.ws, OWNER);

    expect(sock.closed()).toBe(false);
    expect(sock.hasMessageHandler()).toBe(true);
  });

  it("refuses a different authenticated user and closes the socket", async () => {
    await startOwnedSession();

    const sock = fakeWs();
    attachSocket(sock.ws, INTRUDER);

    expect(sock.closed()).toBe(true);
    // It must not have been handed the recorded-action feed.
    expect(sock.sent.join("")).not.toContain("feedReset");
    expect(sock.sent.join("")).toContain("Not your recording session");
  });

  it("does not register an inbound message handler for a non-owner", async () => {
    await startOwnedSession();

    const sock = fakeWs();
    attachSocket(sock.ws, INTRUDER);

    // No handler means none of the 22 control messages — including
    // `navigate`, which is an SSRF primitive against the recorder
    // Chromium — are reachable.
    expect(sock.hasMessageHandler()).toBe(false);
  });

  it("ignores inbound messages once the session owner no longer matches", async () => {
    await startOwnedSession();
    const sock = fakeWs();
    attachSocket(sock.ws, OWNER);

    mocks.page.goto.mockClear();
    // Same socket, but the singleton session is now owned by someone
    // else (e.g. an admin force-discarded and a different user started
    // recording). The per-message re-check must drop the message.
    await shutdown().catch(() => {});
    await startOwnedSessionAs(INTRUDER);

    await sock.deliver({ type: "navigate", url: "https://attacker.example" });

    expect(mocks.page.goto).not.toHaveBeenCalledWith(
      "https://attacker.example",
    );
  });

  it("closes with an error when there is no active session at all", async () => {
    const sock = fakeWs();
    attachSocket(sock.ws, OWNER);

    expect(sock.closed()).toBe(true);
    expect(sock.sent.join("")).toContain("No active recording");
  });
});

/** Start a session owned by an arbitrary user id. */
async function startOwnedSessionAs(userId: string): Promise<void> {
  const name = `SockOwn${++suiteSeq}`;
  const project = await createProject({
    solutionName: name,
    namespace: `${name}.QA`,
  });
  setCurrentProject(project);
  const relSuite = path.join("Tests", `${name}Suite.cs`);
  await fs.mkdir(path.join(project.rootPath, "Tests"), { recursive: true });
  await fs.writeFile(path.join(project.rootPath, relSuite), "// seeded\n");
  await start(
    {
      startUrl: "https://example.com/login",
      urlName: "Login",
      target: "testMethod",
      methodName: "Login",
      existingTestClassPath: relSuite,
      newTestClassName: null,
    },
    userId,
  );
}

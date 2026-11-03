/**
 * Coverage for the WS-handler `insert-shared-step` splice (Tier-2 shared
 * steps insert-at-position). Verifies for a live recording session:
 *
 *   1. APPEND (no `atIndex`): cloned macro actions land at the tail of
 *      session.actions; per-action `action` envelopes are broadcast
 *      with sequential server indices; `insertSharedStepResult`
 *      reports `atIndex === preCount` and the right inserted indices.
 *
 *   2. INSERT IN MIDDLE (in-range `atIndex`): the splice happens at
 *      that index; subsequent indices shift; the broadcast switches to
 *      a single `actions-resync` envelope (cheap-path fallback) so
 *      every panel rebuilds its feed.
 *
 *   3. NOT FOUND: a name with no matching shared_steps row returns
 *      `insertSharedStepError` and does not mutate the action feed.
 *
 *   4. EMPTY/MISSING NAME: returns `insertSharedStepError` and does
 *      not mutate the feed.
 *
 *   5. CROSS-USER ISOLATION: a shared_steps row owned by a *different*
 *      user is invisible to the session owner (returns "not found" —
 *      proves getSharedStep is keyed by session.userId).
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, sharedStepsTable } from "@workspace/db";
import { provisionUser, deleteUserByUsername } from "@/shared/test-helpers";

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
    url: vi.fn().mockReturnValue("https://example.com/login"),
    locator: vi.fn().mockReturnValue({ first: () => ({ fill: vi.fn() }) }),
    screenshot: vi.fn().mockImplementation(() => new Promise(() => undefined)),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    exposeBinding: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    storageState: vi.fn().mockResolvedValue({ cookies: [], origins: [] }),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { page, context, browser };
});

vi.mock("playwright", () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mocks.browser) },
}));

vi.mock("@/features/audit/infrastructure/recordAudit", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import {
  setCurrentProject,
  type Project,
} from "@/features/projects/infrastructure/projectService";
import * as recording from "@/features/recording/infrastructure/recordingService";

const ADMIN_USERNAME = "vitest-splice-admin";
const OTHER_USERNAME = "vitest-splice-other";
const PROJECT = "SpliceProj";
const TEST_PROJECT = "SpliceProj.Tests";
const NAMESPACE = "SpliceProj";

let adminUserId = "";
let otherUserId = "";
let tmp = "";

function makeProject(rootPath: string): Project {
  return {
    solutionName: PROJECT,
    testProjectName: TEST_PROJECT,
    namespace: NAMESPACE,
    rootPath,
    slnPath: path.join(rootPath, `${PROJECT}.sln`),
    language: "csharp",
  };
}

async function scaffold(): Promise<{ tmp: string; project: Project }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "splice-"));
  const project = makeProject(dir);
  await fs.mkdir(path.join(dir, TEST_PROJECT, "Tests"), { recursive: true });
  await fs.writeFile(
    path.join(dir, TEST_PROJECT, "appsettings.json"),
    JSON.stringify({ Urls: {} }, null, 2),
  );
  await fs.writeFile(
    path.join(dir, TEST_PROJECT, "Tests", "SpliceTests.cs"),
    `namespace ${NAMESPACE}.Tests { public class SpliceTests {} }\n`,
  );
  return { tmp: dir, project };
}

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

async function emitClick(selector: string): Promise<void> {
  emit(null, {
    type: "click",
    selector,
    selectorStrategy: "css",
    url: "https://example.com/login",
  });
  await new Promise((r) => setImmediate(r));
}

function findLast(type: string): Record<string, unknown> | null {
  for (let i = sentToWs.length - 1; i >= 0; i--) {
    const m = JSON.parse(sentToWs[i]!) as Record<string, unknown>;
    if (m.type === type) return m;
  }
  return null;
}

function findAll(type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const raw of sentToWs) {
    const m = JSON.parse(raw) as Record<string, unknown>;
    if (m.type === type) out.push(m);
  }
  return out;
}

beforeAll(async () => {
  adminUserId = (
    await provisionUser({ username: ADMIN_USERNAME, role: "admin" })
  ).id;
  otherUserId = (
    await provisionUser({ username: OTHER_USERNAME, role: "admin" })
  ).id;
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(OTHER_USERNAME);
});

beforeEach(async () => {
  ({ tmp } = await scaffold());
  const project = makeProject(tmp);
  setCurrentProject(project, adminUserId);
  mocks.context.exposeBinding.mockClear();
  await recording.start(
    {
      startUrl: "https://example.com/login",
      urlName: "Login",
      target: "testMethod",
      methodName: "Splice",
      existingTestClassPath: `${TEST_PROJECT}/Tests/SpliceTests.cs`,
      newTestClassName: null,
    },
    adminUserId,
    project,
  );
  const call = mocks.context.exposeBinding.mock.calls.find(
    (c) => c[0] === "__recorderEmit",
  );
  if (!call) throw new Error("__recorderEmit binding never registered");
  emit = call[1] as Emit;
  fakeWs();
});

afterEach(async () => {
  await recording.shutdown();
  setCurrentProject(null, adminUserId);
  setCurrentProject(null, otherUserId);
  await db
    .delete(sharedStepsTable)
    .where(eq(sharedStepsTable.projectName, PROJECT));
  await fs.rm(tmp, { recursive: true, force: true });
});

async function seedMacro(args: {
  userId: string;
  name: string;
  actions: Record<string, unknown>[];
}): Promise<void> {
  await db.insert(sharedStepsTable).values({
    userId: args.userId,
    projectName: PROJECT,
    name: args.name,
    description: "",
    actions: args.actions,
  });
}

describe("WS handler `insert-shared-step` — splice in live session", () => {
  it("APPEND (no atIndex): cloned actions land at tail and broadcast as per-action envelopes", async () => {
    await seedMacro({
      userId: adminUserId,
      name: "Login",
      actions: [
        { type: "click", selector: "[data-testid=login]" },
        { type: "fill", selector: "[name=user]", value: "admin" },
      ],
    });
    await emitClick("[data-testid=alpha]");
    sentToWs.length = 0;

    await wsHandler(JSON.stringify({ type: "insert-shared-step", name: "Login" }));

    const result = findLast("insertSharedStepResult");
    expect(result).toMatchObject({
      type: "insertSharedStepResult",
      name: "Login",
      insertedCount: 2,
      atIndex: 1, // appended after the single existing alpha click
      indices: [1, 2],
    });
    // Append cheap-path: per-action broadcasts, NOT a resync.
    expect(findAll("action").length).toBe(2);
    expect(findLast("actions-resync")).toBeNull();
  });

  it("INSERT IN MIDDLE (atIndex=1): splices, shifts subsequent indices, broadcasts a single actions-resync", async () => {
    await seedMacro({
      userId: adminUserId,
      name: "Mid",
      actions: [{ type: "click", selector: "[data-testid=mid]" }],
    });
    await emitClick("[data-testid=alpha]");
    await emitClick("[data-testid=beta]");
    await emitClick("[data-testid=gamma]");
    sentToWs.length = 0;

    await wsHandler(
      JSON.stringify({
        type: "insert-shared-step",
        name: "Mid",
        atIndex: 1,
      }),
    );

    const result = findLast("insertSharedStepResult");
    expect(result).toMatchObject({
      name: "Mid",
      insertedCount: 1,
      atIndex: 1,
      indices: [1],
    });
    // Splice-in-middle path: a SINGLE resync, not per-action envelopes.
    const resync = findLast("actions-resync");
    expect(resync).not.toBeNull();
    // actions-resync flattens the action onto the row (selector at top
    // level alongside `index`), unlike `feedReset` which nests under
    // `.action`. Mirror the on-the-wire shape exactly.
    const rows = resync!.actions as Array<{
      index: number;
      selector?: string;
    }>;
    expect(rows).toHaveLength(4);
    expect(rows[0]!.selector).toBe("[data-testid=alpha]");
    expect(rows[1]!.selector).toBe("[data-testid=mid]");
    expect(rows[2]!.selector).toBe("[data-testid=beta]");
    expect(rows[3]!.selector).toBe("[data-testid=gamma]");
    expect(findAll("action").length).toBe(0);
  });

  it("out-of-range atIndex falls back to APPEND", async () => {
    await seedMacro({
      userId: adminUserId,
      name: "Tail",
      actions: [{ type: "click", selector: "#tail" }],
    });
    await emitClick("#a");
    sentToWs.length = 0;

    await wsHandler(
      JSON.stringify({
        type: "insert-shared-step",
        name: "Tail",
        atIndex: 999,
      }),
    );

    const result = findLast("insertSharedStepResult");
    expect(result).toMatchObject({ atIndex: 1, indices: [1] });
    expect(findAll("action").length).toBe(1);
    expect(findLast("actions-resync")).toBeNull();
  });

  it("returns insertSharedStepError for an unknown name without mutating the feed", async () => {
    await emitClick("#a");
    sentToWs.length = 0;

    await wsHandler(
      JSON.stringify({ type: "insert-shared-step", name: "Nope" }),
    );

    const err = findLast("insertSharedStepError");
    expect(err).toMatchObject({
      type: "insertSharedStepError",
      message: expect.stringMatching(/Nope.*not found/i),
    });
    expect(findLast("insertSharedStepResult")).toBeNull();
    expect(findAll("action").length).toBe(0);
    expect(findLast("actions-resync")).toBeNull();
  });

  it("returns insertSharedStepError when name is missing/empty", async () => {
    await wsHandler(JSON.stringify({ type: "insert-shared-step", name: "  " }));
    expect(findLast("insertSharedStepError")).toMatchObject({
      message: expect.stringMatching(/required/i),
    });
  });

  it("CROSS-USER ISOLATION: a macro owned by another user is not visible to the session owner", async () => {
    await seedMacro({
      userId: otherUserId,
      name: "Theirs",
      actions: [{ type: "click", selector: "#theirs" }],
    });
    await wsHandler(
      JSON.stringify({ type: "insert-shared-step", name: "Theirs" }),
    );
    expect(findLast("insertSharedStepError")).toMatchObject({
      message: expect.stringMatching(/Theirs.*not found/i),
    });
    expect(findLast("insertSharedStepResult")).toBeNull();
  });
});

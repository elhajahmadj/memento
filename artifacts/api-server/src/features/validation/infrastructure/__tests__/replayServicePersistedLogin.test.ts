/**
 * End-to-end fixture-backed integration test proving that persisted
 * login `storageState` (saved via /api/auth-state/save during a capture
 * session) IS consumed by the replay/validation service:
 *
 *   1. Seed `auth_states` with a Playwright `storageState()`-shaped row
 *      for (recordingOwnerUserId, projectName).
 *   2. Seed one recording owned by that user.
 *   3. Drive the validation pump to completion.
 *   4. Assert `chromium.newContext` was invoked with `storageState` ===
 *      our seeded payload (cookies + origins, verbatim).
 *
 * This complements `authStateCaptureConsume.test.ts`, which exercises
 * the recorder-side (`recording.start`) consume path.
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
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => {
  const goto = vi.fn().mockResolvedValue(undefined);
  const click = vi.fn().mockResolvedValue(undefined);
  const fill = vi.fn().mockResolvedValue(undefined);
  const screenshot = vi.fn().mockResolvedValue(undefined);
  const locatorFirst = { click, fill };
  const locator = vi.fn().mockReturnValue({ first: () => locatorFirst });
  const page = {
    goto,
    locator,
    screenshot,
    on: vi.fn(),
    mainFrame: () => ({ url: () => "" }),
    url: vi.fn().mockReturnValue("http://localhost/"),
  };
  const tracing = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    tracing,
    close: vi.fn().mockResolvedValue(undefined),
  };
  const newContext = vi.fn().mockResolvedValue(context);
  const browser = { newContext, close: vi.fn().mockResolvedValue(undefined) };
  const launch = vi.fn().mockResolvedValue(browser);
  return { launch, newContext };
});

vi.mock("playwright", () => ({ chromium: { launch: mocks.launch } }));

import {
  bootServer,
  deleteUserByUsername,
  provisionUser,
} from "@/shared/test-helpers";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  createProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import { saveActionSet } from "@/features/recording/infrastructure/recordedActionStore";
import { saveAuthState } from "@/features/auth-states/infrastructure/authStateService";
import { enqueueValidateAll } from "@/features/validation/infrastructure/replayService";
import { db, validationRunsTable, authStatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

let close: () => Promise<void>;
let tmp: string;
let originalWorkspace: string;
let userId = "";
let fixtureServer: http.Server;
let fixtureUrl = "";

const USERNAME = "vitest-replay-persisted-login";

beforeAll(async () => {
  ({ close } = await bootServer());
  const u = await provisionUser({ username: USERNAME, role: "admin" });
  userId = u.id;
  fixtureServer = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><body><button id="go">Go</button></body></html>`);
  });
  await new Promise<void>((resolve) => fixtureServer.listen(0, resolve));
  const addr = fixtureServer.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${addr.port}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
  await deleteUserByUsername(USERNAME);
  await close();
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-persisted-login-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
  mocks.launch.mockClear();
  mocks.newContext.mockClear();
});

afterEach(async () => {
  setCurrentProject(null, userId);
  recorderConfig.workspaceDir = originalWorkspace;
  await db
    .delete(authStatesTable)
    .where(eq(authStatesTable.userId, userId));
  await fs.rm(tmp, { recursive: true, force: true });
});

async function waitFor(
  predicate: () => Promise<boolean>,
  { timeoutMs = 8000, intervalMs = 50 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe("replay/validation — persisted-login storageState consumption", () => {
  it("hydrates chromium.newContext with the saved storageState row when the recording owner has one", async () => {
    const project = await createProject({
      solutionName: "PersistedLogin",
      namespace: "PersistedLogin.QA",
    });
    setCurrentProject(project, userId);

    // Seed a Playwright-shaped storageState payload owned by the
    // recording's owner. The exact shape is opaque to replayService —
    // we just need object identity to round-trip into newContext().
    const seededState = {
      cookies: [
        {
          name: "session",
          value: "abc123",
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax" as const,
        },
      ],
      origins: [
        {
          origin: fixtureUrl.replace(/\/$/, ""),
          localStorage: [{ name: "userId", value: "u-42" }],
        },
      ],
    };
    await saveAuthState({
      userId,
      projectName: project.solutionName,
      label: "QA admin (persisted)",
      state: seededState,
    });

    await saveActionSet({
      userId,
      projectName: project.solutionName,
      filePath: "Tests/PersistedLoginSmoke.cs",
      kind: "testMethod",
      methodName: "Smoke",
      urlName: "FixtureHome",
      startUrl: fixtureUrl,
      actions: [{ type: "click", selector: "#go", selectorStrategy: "css" }],
    });

    const parentId = await enqueueValidateAll({ userId, project });

    await waitFor(async () => {
      const [row] = await db
        .select({ status: validationRunsTable.status })
        .from(validationRunsTable)
        .where(eq(validationRunsTable.id, parentId));
      if (!row) return false;
      if (row.status === "failed" || row.status === "error") {
        const [full] = await db
          .select({ summary: validationRunsTable.summary })
          .from(validationRunsTable)
          .where(eq(validationRunsTable.id, parentId));
        throw new Error(
          `parent run ended in '${row.status}'. summary=${JSON.stringify(full?.summary)}`,
        );
      }
      return row.status === "passed";
    });

    // The pump opened exactly one context for the single recording, and
    // hydrated it with the saved storageState verbatim.
    expect(mocks.newContext).toHaveBeenCalled();
    const ctxArg = mocks.newContext.mock.calls[0]![0] as {
      storageState?: unknown;
      viewport?: unknown;
    };
    expect(ctxArg.storageState).toEqual(seededState);
    expect(ctxArg.viewport).toBeDefined();
  });

  it("falls back to a clean context (no storageState) when the recording owner has no saved row", async () => {
    const project = await createProject({
      solutionName: "PersistedLoginMissing",
      namespace: "PersistedLoginMissing.QA",
    });
    setCurrentProject(project, userId);

    // Intentionally NO saveAuthState() call — the lookup must miss and
    // the pump must still complete successfully.
    await saveActionSet({
      userId,
      projectName: project.solutionName,
      filePath: "Tests/NoLoginSmoke.cs",
      kind: "testMethod",
      methodName: "Smoke",
      urlName: "FixtureHome",
      startUrl: fixtureUrl,
      actions: [{ type: "click", selector: "#go", selectorStrategy: "css" }],
    });

    const parentId = await enqueueValidateAll({ userId, project });
    await waitFor(async () => {
      const [row] = await db
        .select({ status: validationRunsTable.status })
        .from(validationRunsTable)
        .where(eq(validationRunsTable.id, parentId));
      return row?.status === "passed";
    });

    expect(mocks.newContext).toHaveBeenCalled();
    const ctxArg = mocks.newContext.mock.calls[0]![0] as {
      storageState?: unknown;
    };
    // Missing rows must NOT inject a storageState key.
    expect(ctxArg.storageState).toBeUndefined();
  });
});

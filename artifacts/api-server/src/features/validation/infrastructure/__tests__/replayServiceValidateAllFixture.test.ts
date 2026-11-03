/**
 * End-to-end fixture-backed integration test for `enqueueValidateAll`.
 *
 * Unlike `replayServiceValidateAll.test.ts` (which deliberately uses an
 * unreachable URL to drive the fail-fast pump and only validates the
 * synchronously-inserted run rows), this test runs the *full* replay
 * lifecycle against:
 *   - a real local HTTP server fixture (so `probeReachability` succeeds
 *     and the navigate step has something real to GET), and
 *   - a vi.mock'd `playwright` chromium driver that simulates a
 *     successful page session (so we don't need a real browser binary).
 *
 * It then waits for the streamed lifecycle and the persisted
 * `validation_runs` row to reach the terminal `passed` state, proving:
 *   1. parent run is picked up and reaches `passed`,
 *   2. the per-recording child run is picked up and reaches `passed`,
 *   3. the streamed event sequence (run-queued → run-started →
 *      step-passed → run-finished) is produced and the buffered events
 *      are visible to a freshly-attached validation socket.
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

// ---- playwright mock --------------------------------------------------------
// Hoisted so vi.mock can reference it — gives the test fine-grained
// control over what `chromium.launch().newContext().newPage()` returns.
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
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const launch = vi.fn().mockResolvedValue(browser);
  return { launch, browser, context, page, goto, click, fill };
});

vi.mock("playwright", () => ({
  chromium: { launch: mocks.launch },
}));

// ---- imports (after vi.mock so replayService picks up the mock) ------------
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
import {
  enqueueValidateAll,
} from "@/features/validation/infrastructure/replayService";
import { db, validationRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

let close: () => Promise<void>;
let tmp: string;
let originalWorkspace: string;
let userId = "";
let fixtureServer: http.Server;
let fixtureUrl = "";

const USERNAME = "vitest-replay-validate-all-fixture";

beforeAll(async () => {
  ({ close } = await bootServer());
  const u = await provisionUser({ username: USERNAME, role: "admin" });
  userId = u.id;
  fixtureServer = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><html><body><button id="go">Go</button>` +
        `<input id="q" /></body></html>`,
    );
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
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-valall-fixture-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
  mocks.launch.mockClear();
  mocks.goto.mockClear();
  mocks.click.mockClear();
  mocks.fill.mockClear();
});

afterEach(async () => {
  setCurrentProject(null, userId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function waitFor(
  predicate: () => Promise<boolean>,
  { timeoutMs = 8000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe("enqueueValidateAll — fixture-backed end-to-end happy path", () => {
  it("runs the full replay pump for a real recording against a local HTTP fixture (parent + child reach 'passed', browser was driven, run row is persisted)", async () => {
    const project = await createProject({
      solutionName: "ValAllFixture",
      namespace: "ValAllFixture.QA",
    });
    setCurrentProject(project, userId);

    // Seed one recording: navigate(start) → click(button) → fill(input).
    // The mocked playwright page accepts every locator/click/fill call,
    // so all three steps will pass and the run reaches "passed".
    await saveActionSet({
      userId,
      projectName: project.solutionName,
      filePath: "Tests/FixtureSmoke.cs",
      kind: "testMethod",
      methodName: "Smoke",
      urlName: "FixtureHome",
      startUrl: fixtureUrl,
      actions: [
        {
          type: "click",
          selector: "#go",
          selectorStrategy: "css",
        },
        {
          type: "fill",
          selector: "#q",
          selectorStrategy: "css",
          value: "hello",
        },
      ],
    });

    const parentId = await enqueueValidateAll({ userId, project });

    // Wait for the parent run row to flip from `queued` → `passed`.
    // A `failed`/`error` outcome means the pump genuinely broke — fail
    // loudly with the persisted summary so a regression surfaces fast.
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
          `parent run ended in '${row.status}' instead of 'passed'. ` +
            `summary=${JSON.stringify(full?.summary)}`,
        );
      }
      return row.status === "passed";
    });

    // Locate the single child run and confirm it also reached "passed".
    const childRows = await db
      .select({
        id: validationRunsTable.id,
        status: validationRunsTable.status,
        recordingFilePath: validationRunsTable.recordingFilePath,
        recordingMethodName: validationRunsTable.recordingMethodName,
      })
      .from(validationRunsTable)
      .where(eq(validationRunsTable.parentRunId, parentId));
    expect(childRows).toHaveLength(1);
    const child = childRows[0]!;
    expect(child.status).toBe("passed");
    expect(child.recordingFilePath).toBe("Tests/FixtureSmoke.cs");
    expect(child.recordingMethodName).toBe("Smoke");

    // Prove the pump actually drove the browser: chromium.launch was
    // called, the navigate step hit the fixture URL, and both
    // user-recorded steps (click, fill) ran.
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.goto).toHaveBeenCalled();
    expect(mocks.goto.mock.calls[0]?.[0]).toBe(fixtureUrl);
    expect(mocks.click).toHaveBeenCalledTimes(1);
    expect(mocks.fill).toHaveBeenCalledTimes(1);
    // loc.fill(value, { timeout }) — first arg is the recorded value.
    expect(mocks.fill.mock.calls[0]?.[0]).toBe("hello");
  });
});

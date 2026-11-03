/**
 * Persisted-login round-trip tests for the Tier-2 "Capture login" flow.
 * Covers the two server-side hot-paths:
 *
 *   CAPTURE: starting a recording in `captureMode: true`, then calling
 *            captureAndSaveAuthState() reads the live BrowserContext's
 *            storageState() and persists it under (userId, projectName).
 *
 *   CONSUME: starting a follow-up recording with `useSavedLogin: true`
 *            hydrates the new BrowserContext via the persisted row.
 *            Verified by inspecting the args passed to
 *            browser.newContext() through the playwright mock.
 *
 * Owner-gating + invalid-state rejection are also covered.
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
import { and, eq } from "drizzle-orm";
import { db, authStatesTable } from "@workspace/db";
import { provisionUser, deleteUserByUsername } from "@/shared/test-helpers";
import { isEncryptedState } from "@/features/auth-states/infrastructure/authStateCrypto";
import { loadAuthStateStorageState } from "@/features/auth-states/infrastructure/authStateService";

const STORAGE_STATE = {
  cookies: [
    { name: "session", value: "captured-cookie", domain: "example.com" },
  ],
  origins: [
    {
      origin: "https://example.com",
      localStorage: [{ name: "token", value: "abc" }],
    },
  ],
} as const;

const mocks = vi.hoisted(() => {
  const storageStateMock = vi
    .fn()
    .mockResolvedValue({
      cookies: [
        { name: "session", value: "captured-cookie", domain: "example.com" },
      ],
      origins: [
        {
          origin: "https://example.com",
          localStorage: [{ name: "token", value: "abc" }],
        },
      ],
    });
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
    locator: vi.fn(),
    screenshot: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    context: vi.fn(),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    exposeBinding: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    storageState: storageStateMock,
  };
  page.context.mockReturnValue(context);
  const newContext = vi.fn().mockResolvedValue(context);
  const browser = { newContext, close: vi.fn().mockResolvedValue(undefined) };
  return { page, context, browser, newContext, storageStateMock };
});

vi.mock("playwright", () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mocks.browser) },
}));

import {
  setCurrentProject,
  type Project,
} from "@/features/projects/infrastructure/projectService";
import * as recording from "@/features/recording/infrastructure/recordingService";

const ADMIN_USERNAME = "vitest-auth-cap-admin";
const OTHER_USERNAME = "vitest-auth-cap-other";
const PROJECT = "AuthCapProj";
const TEST_PROJECT = "AuthCapProj.Tests";

let adminUserId = "";
let otherUserId = "";
let tmp = "";

function makeProject(rootPath: string, name = PROJECT): Project {
  return {
    solutionName: name,
    testProjectName: TEST_PROJECT,
    namespace: name,
    rootPath,
    slnPath: path.join(rootPath, `${name}.sln`),
    language: "csharp",
  };
}

async function scaffold(): Promise<{ tmp: string; project: Project }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-cap-"));
  const project = makeProject(dir);
  await fs.mkdir(path.join(dir, TEST_PROJECT), { recursive: true });
  await fs.writeFile(
    path.join(dir, TEST_PROJECT, "appsettings.json"),
    JSON.stringify({ Urls: {} }, null, 2),
  );
  return { tmp: dir, project };
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
  mocks.context.exposeBinding.mockClear();
  mocks.newContext.mockClear();
  mocks.storageStateMock.mockClear();
  await db
    .delete(authStatesTable)
    .where(eq(authStatesTable.projectName, PROJECT));
});

afterEach(async () => {
  await recording.shutdown().catch(() => {});
  setCurrentProject(null, adminUserId);
  setCurrentProject(null, otherUserId);
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("captureAndSaveAuthState — capture path", () => {
  it("starting a captureMode recording then capturing persists the live storageState", async () => {
    const project = makeProject(tmp);
    setCurrentProject(project, adminUserId);
    await recording.start(
      {
        startUrl: "https://example.com/login",
        urlName: "Login",
        target: "testMethod",
        methodName: "Cap",
        newTestClassName: "Cap",
        captureMode: true,
      },
      adminUserId,
      project,
    );

    const summary = await recording.captureAndSaveAuthState({
      userId: adminUserId,
      projectName: PROJECT,
      label: "QA admin",
    });

    expect(summary.hasState).toBe(true);
    expect(summary.label).toBe("QA admin");
    expect(mocks.storageStateMock).toHaveBeenCalledTimes(1);

    // Persisted row matches what context.storageState() returned.
    const [row] = await db
      .select()
      .from(authStatesTable)
      .where(
        and(
          eq(authStatesTable.userId, adminUserId),
          eq(authStatesTable.projectName, PROJECT),
        ),
      );
    expect(row).toBeDefined();
    expect(row!.label).toBe("QA admin");
    // H-2: the column now holds AES-256-GCM ciphertext, not the raw
    // payload — the captured cookies must not be readable from a plain
    // DB read. The round-trip is asserted through the service instead.
    expect(isEncryptedState(row!.state)).toBe(true);
    expect(JSON.stringify(row!.state)).not.toContain("captured-cookie");
    expect(
      await loadAuthStateStorageState({
        userId: adminUserId,
        projectName: PROJECT,
      }),
    ).toEqual(STORAGE_STATE);
  });

  it("rejects when the caller is not the session owner", async () => {
    const project = makeProject(tmp);
    setCurrentProject(project, adminUserId);
    await recording.start(
      {
        startUrl: "https://example.com/login",
        urlName: "Login",
        target: "testMethod",
        methodName: "Cap2",
        newTestClassName: "Cap2",
        captureMode: true,
      },
      adminUserId,
      project,
    );

    await expect(
      recording.captureAndSaveAuthState({
        userId: otherUserId,
        projectName: PROJECT,
        label: "thief",
      }),
    ).rejects.toThrow(/session owner/i);
  });

  it("rejects when there's no live recording at all", async () => {
    await expect(
      recording.captureAndSaveAuthState({
        userId: adminUserId,
        projectName: PROJECT,
        label: "x",
      }),
    ).rejects.toThrow(/No active recording/i);
  });

  it("rejects when the live recording belongs to a different project", async () => {
    const project = makeProject(tmp, "OtherProj");
    setCurrentProject(project, adminUserId);
    await recording.start(
      {
        startUrl: "https://example.com/login",
        urlName: "Login",
        target: "testMethod",
        methodName: "Cap3",
        newTestClassName: "Cap3",
        captureMode: true,
      },
      adminUserId,
      project,
    );
    await expect(
      recording.captureAndSaveAuthState({
        userId: adminUserId,
        projectName: PROJECT,
        label: "x",
      }),
    ).rejects.toThrow(/different project/i);
  });
});

describe("useSavedLogin — consume path", () => {
  it("hydrates browser.newContext() with the persisted storageState", async () => {
    // Persist a row directly so we don't need a previous capture
    // session — keeps this test focused on consumption.
    await db.insert(authStatesTable).values({
      userId: adminUserId,
      projectName: PROJECT,
      label: "preset",
      state: STORAGE_STATE,
    });

    const project = makeProject(tmp);
    setCurrentProject(project, adminUserId);
    await recording.start(
      {
        startUrl: "https://example.com/app",
        urlName: "App",
        target: "testMethod",
        methodName: "Hydrated",
        newTestClassName: "Hydrated",
        useSavedLogin: true,
      },
      adminUserId,
      project,
    );

    expect(mocks.newContext).toHaveBeenCalledTimes(1);
    const ctxArg = mocks.newContext.mock.calls[0]![0] as {
      storageState?: unknown;
    };
    expect(ctxArg.storageState).toEqual(STORAGE_STATE);
  });

  it("missing row when useSavedLogin=true is silently ignored (no storageState passed, recording still starts)", async () => {
    const project = makeProject(tmp);
    setCurrentProject(project, adminUserId);
    await recording.start(
      {
        startUrl: "https://example.com/app",
        urlName: "App",
        target: "testMethod",
        methodName: "NoState",
        newTestClassName: "NoState",
        useSavedLogin: true,
      },
      adminUserId,
      project,
    );
    const ctxArg = mocks.newContext.mock.calls[0]![0] as {
      storageState?: unknown;
    };
    expect(ctxArg.storageState).toBeUndefined();
  });

  it("does NOT pass storageState when useSavedLogin is omitted, even if a row exists", async () => {
    await db.insert(authStatesTable).values({
      userId: adminUserId,
      projectName: PROJECT,
      label: "ignored",
      state: STORAGE_STATE,
    });
    const project = makeProject(tmp);
    setCurrentProject(project, adminUserId);
    await recording.start(
      {
        startUrl: "https://example.com/app",
        urlName: "App",
        target: "testMethod",
        methodName: "OptedOut",
        newTestClassName: "OptedOut",
      },
      adminUserId,
      project,
    );
    const ctxArg = mocks.newContext.mock.calls[0]![0] as {
      storageState?: unknown;
    };
    expect(ctxArg.storageState).toBeUndefined();
  });
});

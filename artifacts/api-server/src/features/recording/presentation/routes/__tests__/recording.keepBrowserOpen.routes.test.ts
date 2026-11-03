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
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Same playwright mock shape used by the other recording route tests
// so we never spawn a real chromium browser. The mock browser's
// `close` counter is the signal that proves the keep-browser-open
// flag flowed all the way from the HTTP request body into the
// service layer.
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
    screenshot: vi
      .fn()
      .mockImplementation(() => new Promise(() => undefined)),
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

import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  createProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import { shutdown } from "@/features/recording/infrastructure/recordingService";

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let tmp: string;
let originalWorkspace: string;
let adminUserId = "";

const ADMIN_USERNAME = "vitest-keepopen-admin";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await close();
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-keepopen-routes-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
  mocks.browser.close.mockClear();
});

afterEach(async () => {
  await shutdown().catch(() => {});
  setCurrentProject(null, adminUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("task #120 — keepBrowserOpen route plumbing", () => {
  it("POST /api/recording/start defaults keepBrowserOpen to false when omitted", async () => {
    const project = await createProject({
      solutionName: "StartDefault",
      namespace: "StartDefault.QA",
    });
    setCurrentProject(project, adminUserId);

    const res = await fetch(`${baseUrl}/api/recording/start`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        startUrl: "https://example.com/",
        urlName: "BaseUrl",
        target: "testMethod",
        methodName: "First",
        newTestClassName: "StartDefault",
        // keepBrowserOpen omitted
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      keepBrowserOpen?: boolean;
      active: boolean;
    };
    expect(body.active).toBe(true);
    expect(body.keepBrowserOpen).toBe(false);

    // GET /status reports the same default.
    const status = await fetch(`${baseUrl}/api/recording/status`, {
      headers: withCookie(adminCookie),
    });
    const statusBody = (await status.json()) as { keepBrowserOpen?: boolean };
    expect(statusBody.keepBrowserOpen).toBe(false);

    // Sanity: a Stop on a default session DOES close the browser
    // (it's the foil to the keep-open case below).
    await fetch(`${baseUrl}/api/recording/stop`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    expect(mocks.browser.close).toHaveBeenCalledTimes(1);
  });

  it("POST /api/recording/start forwards keepBrowserOpen=true and Stop keeps the browser alive", async () => {
    const project = await createProject({
      solutionName: "StartKeepOpen",
      namespace: "StartKeepOpen.QA",
    });
    setCurrentProject(project, adminUserId);

    const res = await fetch(`${baseUrl}/api/recording/start`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        startUrl: "https://example.com/",
        urlName: "BaseUrl",
        target: "testMethod",
        methodName: "First",
        newTestClassName: "StartKeepOpen",
        keepBrowserOpen: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keepBrowserOpen?: boolean };
    expect(body.keepBrowserOpen).toBe(true);

    const stop = await fetch(`${baseUrl}/api/recording/stop`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    expect(stop.status).toBe(200);
    expect(mocks.browser.close).not.toHaveBeenCalled();

    const status = await fetch(`${baseUrl}/api/recording/status`, {
      headers: withCookie(adminCookie),
    });
    const statusBody = (await status.json()) as {
      keepBrowserOpen?: boolean;
      phase?: string;
    };
    expect(statusBody.keepBrowserOpen).toBe(true);
    expect(statusBody.phase).toBe("stopped");
  });

  it("POST /api/recording/attach-to-open-browser forwards keepBrowserOpen=true into session config", async () => {
    const project = await createProject({
      solutionName: "AttachKeepOpen",
      namespace: "AttachKeepOpen.QA",
    });
    setCurrentProject(project, adminUserId);
    const relSuite = path.join("Tests", "AttachKeepOpenSuite.cs");
    await fs.mkdir(path.join(project.rootPath, "Tests"), { recursive: true });
    await fs.writeFile(path.join(project.rootPath, relSuite), "// seeded\n");

    await fetch(`${baseUrl}/api/recording/open-browser`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ url: "https://example.com/" }),
    });

    const attach = await fetch(
      `${baseUrl}/api/recording/attach-to-open-browser`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          existingTestClassPath: relSuite,
          methodName: "Attached",
          keepBrowserOpen: true,
        }),
      },
    );
    expect(attach.status).toBe(200);
    const attachBody = (await attach.json()) as { keepBrowserOpen?: boolean };
    expect(attachBody.keepBrowserOpen).toBe(true);

    const stop = await fetch(`${baseUrl}/api/recording/stop`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    expect(stop.status).toBe(200);
    expect(mocks.browser.close).not.toHaveBeenCalled();
  });
});

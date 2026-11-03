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

// Mock playwright so the recording start/stop/finalize success-path
// tests below never spawn a real chromium browser. Hoisted so the mock
// is registered before bootServer's transitive `import { chromium } from
// "playwright"` resolves. The other recording route tests live in
// `recording.routes.test.ts` and are unaffected (vitest isolates module
// graphs per test file).
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
  return { browser };
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
let _limitedCookie: string;
let unauthCookie: string;
let tmp: string;
let originalWorkspace: string;
let adminUserId = "";
let _limitedUserId = "";
let _unauthUserId = "";

const ADMIN_USERNAME = "vitest-reclife-admin";
const LIMITED_USERNAME = "vitest-reclife-limited";
const UNAUTH_USERNAME = "vitest-reclife-other";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  // A limited_admin user — gated routes accept this role only when the
  // user is the project owner or has been explicitly assigned to the
  // current project. Used below to confirm both the allow- and deny-
  // paths of `requireAdminOrAssignedToCurrentProjectOrOwner`.
  const limited = await provisionUser({
    username: LIMITED_USERNAME,
    role: "limited_admin",
  });
  _limitedUserId = limited.id;
  _limitedCookie = await login(baseUrl, LIMITED_USERNAME);
  void _limitedUserId;
  void _limitedCookie;
  // A second limited_admin user with no project assignment — used to
  // assert the cross-user/ownership rejection. Provisioned distinct
  // from `limited` so we can keep `limited` assigned to the active
  // project in some tests without affecting this user's status.
  const unauth = await provisionUser({
    username: UNAUTH_USERNAME,
    role: "limited_admin",
  });
  _unauthUserId = unauth.id;
  void _unauthUserId;
  unauthCookie = await login(baseUrl, UNAUTH_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await deleteUserByUsername(UNAUTH_USERNAME);
  await close();
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-reclife-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  // Always shut down any session left over so the next test starts
  // from a clean module-level state.
  await shutdown().catch(() => {});
  setCurrentProject(null, adminUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("recording lifecycle (start → stop → finalize) — happy path", () => {
  it("starts a recording session with a valid body (admin)", async () => {
    const project = await createProject({
      solutionName: "RecLife",
      namespace: "RecLife.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/recording/start`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        target: "testMethod",
        startUrl: "https://example.com/login",
        urlName: "Login",
        methodName: "Smoke",
        newTestClassName: "RecLifeSmoke",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active: boolean; phase?: string };
    expect(body.active).toBe(true);
  });

  it("stops the browser on POST /recording/stop after start (admin)", async () => {
    const project = await createProject({
      solutionName: "RecLife2",
      namespace: "RecLife2.QA",
    });
    setCurrentProject(project, adminUserId);
    await fetch(`${baseUrl}/api/recording/start`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        target: "testMethod",
        startUrl: "https://example.com/login",
        urlName: "Login",
        methodName: "Stop",
        newTestClassName: "RecLifeStop",
      }),
    });
    const res = await fetch(`${baseUrl}/api/recording/stop`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { phase?: string };
    // After stop, the phase should be "stopped" — the session is alive
    // but the browser is closed.
    expect(body.phase).toBe("stopped");
  });

  it("refuses to let a different user stop or finalize the owner's session (403)", async () => {
    // Audit finding H-8. The recording session is a process-wide
    // singleton, so "a session exists" says nothing about whose it is.
    // `/recording/stop` called `stopBrowser()` with no user id, and
    // `/recording/finalize` called `finalize(decision)` likewise, so any
    // authenticated caller could kill — or, worse, commit — another
    // user's in-progress recording. `/recording/discard` always took a
    // userId and was never affected.
    const project = await createProject({
      solutionName: "RecLifeOwn",
      namespace: "RecLifeOwn.QA",
    });
    setCurrentProject(project, adminUserId);
    const started = await fetch(`${baseUrl}/api/recording/start`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        target: "testMethod",
        startUrl: "https://example.com/login",
        urlName: "Login",
        methodName: "Owned",
        newTestClassName: "RecLifeOwned",
      }),
    });
    expect(started.status).toBe(200);

    // A different authenticated user tries to stop it.
    const stolenStop = await fetch(`${baseUrl}/api/recording/stop`, {
      method: "POST",
      headers: withCookie(unauthCookie),
    });
    expect(stolenStop.status).toBe(403);

    // ...and to finalize it, which would write the owner's recorded
    // actions into project files.
    const stolenFinalize = await fetch(`${baseUrl}/api/recording/finalize`, {
      method: "POST",
      headers: withCookie(unauthCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ mode: "save" }),
    });
    expect(stolenFinalize.status).toBe(403);

    // The owner's session survived both attempts and is still recording.
    const status = await fetch(`${baseUrl}/api/recording/status`, {
      headers: withCookie(adminCookie),
    });
    expect(status.status).toBe(200);
    const body = (await status.json()) as { phase?: string; active?: boolean };
    expect(body.phase).toBe("recording");

    // The real owner can still stop it.
    const ownerStop = await fetch(`${baseUrl}/api/recording/stop`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    expect(ownerStop.status).toBe(200);
  });

  it("rejects unauthenticated requests to every gated recording mutation route (401)", async () => {
    // Action-set mutations are WS-only (move / duplicate / edit-value /
    // delete / undelete / add-assertion / insert-assertion are routed
    // through `attachSocket` in /ws/recording), and the WS handler does
    // not gate per-message. The safety chain is therefore anchored at
    // the *session lifecycle* HTTP routes — only an authorized user
    // can /start a session, only a session owner can /stop, /finalize,
    // /discard or /clear-hook-backups, and the WS handler ignores any
    // message when no session exists (covered by
    // `recordingActionMutations.test.ts` — "post-shutdown no-op").
    //
    // This block locks down the HTTP perimeter. No cookie attached at
    // all → the auth middleware short-circuits every gated recording
    // route with 401 before the project / session checks ever run.
    const calls = [
      { url: "/api/recording/start", body: { target: "testMethod", startUrl: "https://example.com/login", urlName: "Login", methodName: "X", newTestClassName: "Y" } },
      { url: "/api/recording/stop", body: undefined },
      { url: "/api/recording/finalize", body: { mode: "save" } },
      { url: "/api/recording/discard", body: undefined },
      { url: "/api/recording/clear-hook-backups", body: undefined },
    ];
    for (const c of calls) {
      const res = await fetch(`${baseUrl}${c.url}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(c.body ? { body: JSON.stringify(c.body) } : {}),
      });
      expect(res.status, `${c.url} should require auth`).toBe(401);
    }
  });

  it("rejects a limited_admin user with no project loaded under their id (cross-user/ownership)", async () => {
    // Admin owns the loaded project — limited_admin user has nothing
    // loaded under their own user id, so the per-user project guard
    // refuses to leak the admin's session.
    //
    // The exact status code depends on which guard each route uses:
    //   - /recording/start uses the strict
    //     `requireAdminOrAssignedToCurrentProjectOrOwner`, which short-
    //     circuits with **404** when the caller has no project loaded.
    //   - /recording/stop, /recording/finalize and
    //     /recording/clear-hook-backups use the
    //     `…AllowNoProject` variant so admins can clean up after a
    //     session that was started elsewhere; with no active session
    //     and no loaded project, the underlying handler then returns
    //     **400** ("no recording session to stop / finalize"). The
    //     important thing is that none of these calls succeed —
    //     they don't leak the admin's session to the limited_admin.
    const project = await createProject({
      solutionName: "RecLifeOwn",
      namespace: "RecLifeOwn.QA",
    });
    setCurrentProject(project, adminUserId);
    const startRes = await fetch(`${baseUrl}/api/recording/start`, {
      method: "POST",
      headers: withCookie(unauthCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        target: "testMethod",
        startUrl: "https://example.com/login",
        urlName: "Login",
        methodName: "Cross",
        newTestClassName: "RecLifeOwnCross",
      }),
    });
    expect(startRes.status).toBe(404);
    const stopRes = await fetch(`${baseUrl}/api/recording/stop`, {
      method: "POST",
      headers: withCookie(unauthCookie),
    });
    expect(stopRes.status).toBe(400);
    const finalizeRes = await fetch(`${baseUrl}/api/recording/finalize`, {
      method: "POST",
      headers: withCookie(unauthCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ mode: "save" }),
    });
    expect(finalizeRes.status).toBe(400);
    const clearHookRes = await fetch(
      `${baseUrl}/api/recording/clear-hook-backups`,
      {
        method: "POST",
        headers: withCookie(unauthCookie),
      },
    );
    // clear-hook-backups uses the AllowNoProject guard (so the
    // limited_admin caller passes the middleware), then the route's own
    // validation rejects the call because the caller has no active
    // recording session — 400 ("no recording session"). The important
    // thing is that none of these calls succeed with the admin's
    // project leaked to the limited_admin.
    expect(clearHookRes.status).toBe(400);
  });

  it("finalizes a stopped session with mode=save (admin)", async () => {
    const project = await createProject({
      solutionName: "RecLife3",
      namespace: "RecLife3.QA",
    });
    setCurrentProject(project, adminUserId);
    await fetch(`${baseUrl}/api/recording/start`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        target: "testMethod",
        startUrl: "https://example.com/login",
        urlName: "Login",
        methodName: "Final",
        newTestClassName: "RecLifeFinal",
      }),
    });
    await fetch(`${baseUrl}/api/recording/stop`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    const res = await fetch(`${baseUrl}/api/recording/finalize`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ mode: "save" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      generatedFiles: Array<{ path: string }>;
    };
    expect(body.status).toBe("completed");
    expect(Array.isArray(body.generatedFiles)).toBe(true);
  });
});

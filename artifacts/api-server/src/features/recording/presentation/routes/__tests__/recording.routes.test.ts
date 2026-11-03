import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedCookie: string;
let limitedAdminCookie: string;
let tmp: string;
let originalWorkspace: string;
let adminUserId = "";

const ADMIN_USERNAME = "vitest-recroutes-admin";
const LIMITED_USERNAME = "vitest-recroutes-limited";
const LIMITED_ADMIN_USERNAME = "vitest-recroutes-ladmin";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  await provisionUser({ username: LIMITED_USERNAME, role: "limited" });
  await provisionUser({
    username: LIMITED_ADMIN_USERNAME,
    role: "limited_admin",
  });
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);
  limitedAdminCookie = await login(baseUrl, LIMITED_ADMIN_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await deleteUserByUsername(LIMITED_ADMIN_USERNAME);
  await close();
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-recroutes-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("GET /api/recording/status", () => {
  it("returns the current status object (no project required)", async () => {
    const res = await fetch(`${baseUrl}/api/recording/status`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active?: boolean; phase?: string };
    // The status response always carries either an `active` boolean or a
    // `phase` string depending on whether a session exists, so just assert
    // we got a JSON object back.
    expect(typeof body).toBe("object");
  });

  it("returns 401 without a session", async () => {
    const res = await fetch(`${baseUrl}/api/recording/status`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/recording/hook-state", () => {
  it("rejects an invalid hook value with 400", async () => {
    const project = await createProject({
      solutionName: "RecHook",
      namespace: "RecHook.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(
      `${baseUrl}/api/recording/hook-state?filePath=Tests/X.cs&hook=junk`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(400);
  });

  it("returns hook state for a real hook value (admin)", async () => {
    const project = await createProject({
      solutionName: "RecHookOK",
      namespace: "RecHookOK.QA",
    });
    setCurrentProject(project, adminUserId);
    // Need a real test class file to query state on.
    await fetch(`${baseUrl}/api/codegen/test-class`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ className: "RecHookSmoke" }),
    });
    const res = await fetch(
      `${baseUrl}/api/recording/hook-state?filePath=${encodeURIComponent("Tests/RecHookSmoke.cs")}&hook=beforeEach`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
  });
});

describe("GET /api/recording/replayable-hooks", () => {
  it("rejects without filePath (400)", async () => {
    const project = await createProject({
      solutionName: "RecRH",
      namespace: "RecRH.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/recording/replayable-hooks`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(400);
  });

  it("returns hook replay info for an existing test class (admin)", async () => {
    const project = await createProject({
      solutionName: "RecRHOK",
      namespace: "RecRHOK.QA",
    });
    setCurrentProject(project, adminUserId);
    await fetch(`${baseUrl}/api/codegen/test-class`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ className: "RecRHSmoke" }),
    });
    const res = await fetch(
      `${baseUrl}/api/recording/replayable-hooks?filePath=${encodeURIComponent("Tests/RecRHSmoke.cs")}`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      beforeEach: { hasCustomBody: boolean; hasStoredActions: boolean };
      oneTimeSetup: { hasCustomBody: boolean; hasStoredActions: boolean };
    };
    // Fresh class has the default stub body for both hooks and no
    // stored actions yet.
    expect(body.beforeEach.hasCustomBody).toBe(false);
    expect(body.beforeEach.hasStoredActions).toBe(false);
    expect(body.oneTimeSetup.hasCustomBody).toBe(false);
    expect(body.oneTimeSetup.hasStoredActions).toBe(false);
  });
});

describe("GET /api/recording/method-state", () => {
  it("rejects without methodName (400)", async () => {
    const project = await createProject({
      solutionName: "RecMS",
      namespace: "RecMS.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(
      `${baseUrl}/api/recording/method-state?filePath=Tests/Foo.cs`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(400);
  });

  it("returns { exists: false } for a fresh class (admin)", async () => {
    const project = await createProject({
      solutionName: "RecMSOK",
      namespace: "RecMSOK.QA",
    });
    setCurrentProject(project, adminUserId);
    await fetch(`${baseUrl}/api/codegen/test-class`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ className: "RecMSSmoke" }),
    });
    const res = await fetch(
      `${baseUrl}/api/recording/method-state?filePath=${encodeURIComponent("Tests/RecMSSmoke.cs")}&methodName=BrandNewMethod`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      exists: boolean;
      suggestedName: string;
    };
    expect(body.exists).toBe(false);
    expect(typeof body.suggestedName).toBe("string");
  });
});

describe("POST /api/recording/start", () => {
  it("rejects a malformed body with 400", async () => {
    const project = await createProject({
      solutionName: "RecSt",
      namespace: "RecSt.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/recording/start`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid startUrl with 400", async () => {
    const project = await createProject({
      solutionName: "RecSt2",
      namespace: "RecSt2.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/recording/start`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        target: "newClass",
        startUrl: "not a url",
        urlName: "MyUrl",
        newTestClassName: "BadStart",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects categoryConstantName without categoryValue with 400 (both-or-neither)", async () => {
    // Recorder suite metadata: the category pair must be both-or-neither.
    // Half-supplied pairs are rejected at the route layer so downstream
    // codegens can rely on the invariant. Verified before the chromium
    // launch path so the validation runs even if no session would start.
    const project = await createProject({
      solutionName: "RecCat1",
      namespace: "RecCat1.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/recording/start`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        target: "testMethod",
        methodName: "Smoke",
        startUrl: "https://example.com",
        urlName: "MyUrl",
        newTestClassName: "CatHalfA",
        categoryConstantName: "Smoke",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/categoryConstantName and categoryValue/);
  });

  it("rejects categoryValue without categoryConstantName with 400 (both-or-neither)", async () => {
    const project = await createProject({
      solutionName: "RecCat2",
      namespace: "RecCat2.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/recording/start`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        target: "testMethod",
        methodName: "Smoke",
        startUrl: "https://example.com",
        urlName: "MyUrl",
        newTestClassName: "CatHalfB",
        categoryValue: "smoke-tests",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/categoryConstantName and categoryValue/);
  });

  it("rejects a limited_admin without a project loaded with 404", async () => {
    // Project is loaded for the admin only; limited_admin has nothing
    // current — middleware returns 404 before the chromium launch path.
    const project = await createProject({
      solutionName: "RecSt3",
      namespace: "RecSt3.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/recording/start`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        target: "newClass",
        startUrl: "https://example.com",
        urlName: "MyUrl",
        newTestClassName: "X",
      }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/recording/stop", () => {
  it("returns 400 when there's no active recording", async () => {
    const res = await fetch(`${baseUrl}/api/recording/stop`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/recording/finalize", () => {
  it("rejects an invalid mode value with 400", async () => {
    const res = await fetch(`${baseUrl}/api/recording/finalize`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ mode: "junk" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a limited caller using mode=save with 403", async () => {
    const res = await fetch(`${baseUrl}/api/recording/finalize`, {
      method: "POST",
      headers: withCookie(limitedCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ mode: "save" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/recording/discard", () => {
  it("returns { discarded: false } when nothing is in progress", async () => {
    const res = await fetch(`${baseUrl}/api/recording/discard`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { discarded: boolean };
    expect(body.discarded).toBe(false);
  });
});

describe("POST /api/recording/force-discard", () => {
  it("requires authentication (401 without a cookie)", async () => {
    const res = await fetch(`${baseUrl}/api/recording/force-discard`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin (limited) callers with 403", async () => {
    const res = await fetch(`${baseUrl}/api/recording/force-discard`, {
      method: "POST",
      headers: withCookie(limitedCookie),
    });
    expect(res.status).toBe(403);
  });

  it("returns { discarded: false } for admin when nothing is in progress", async () => {
    const res = await fetch(`${baseUrl}/api/recording/force-discard`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      discarded: boolean;
      previousOwnerUserId: string | null;
      previousProjectName: string | null;
    };
    expect(body.discarded).toBe(false);
    expect(body.previousOwnerUserId).toBeNull();
    expect(body.previousProjectName).toBeNull();
  });

  it("is also accessible to limited_admin (any admin) callers", async () => {
    const res = await fetch(`${baseUrl}/api/recording/force-discard`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { discarded: boolean };
    expect(body.discarded).toBe(false);
  });
});

describe("POST /api/recording/clear-hook-backups", () => {
  it("returns 400 when no project is loaded", async () => {
    setCurrentProject(null, adminUserId);
    const res = await fetch(`${baseUrl}/api/recording/clear-hook-backups`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(400);
  });

  it("succeeds when a project is loaded (admin)", async () => {
    const project = await createProject({
      solutionName: "RecCB",
      namespace: "RecCB.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/recording/clear-hook-backups`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
  });
});

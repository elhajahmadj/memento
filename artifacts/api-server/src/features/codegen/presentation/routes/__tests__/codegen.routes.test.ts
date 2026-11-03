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
let tmp: string;
let originalWorkspace: string;
let adminUserId = "";

const ADMIN_USERNAME = "vitest-codegen-admin";
const LIMITED_USERNAME = "vitest-codegen-limited";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  await provisionUser({ username: LIMITED_USERNAME, role: "limited" });
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await close();
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-codegenroutes-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("POST /api/codegen/test-class", () => {
  it("returns 404 when no project is loaded", async () => {
    setCurrentProject(null, adminUserId);
    const res = await fetch(`${baseUrl}/api/codegen/test-class`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ className: "Smoke" }),
    });
    expect(res.status).toBe(404);
  });

  it("creates a new test class file under the loaded project (admin)", async () => {
    const project = await createProject({
      solutionName: "CGSln",
      namespace: "CG.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/codegen/test-class`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ className: "SmokeTests" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: true; message: string };
    expect(body.ok).toBe(true);
    // The handler returns the *relative* file path — check that the file
    // actually exists on disk under the project root.
    const abs = path.join(project.rootPath, body.message);
    await fs.access(abs);
  });

  it("rejects a limited user with 403 (not assigned to project)", async () => {
    const project = await createProject({
      solutionName: "CGSlnB",
      namespace: "CGB.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/codegen/test-class`, {
      method: "POST",
      headers: withCookie(limitedCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ className: "Smoke" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a malformed body with 400", async () => {
    const project = await createProject({
      solutionName: "CGSlnC",
      namespace: "CGC.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/codegen/test-class`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/codegen/test-method", () => {
  it("returns 404 when no project is loaded", async () => {
    setCurrentProject(null, adminUserId);
    const res = await fetch(`${baseUrl}/api/codegen/test-method`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ filePath: "x.cs", methodName: "DoesIt" }),
    });
    expect(res.status).toBe(404);
  });

  it("appends a new method to an existing test class (admin)", async () => {
    const project = await createProject({
      solutionName: "CGMSln",
      namespace: "CGM.QA",
    });
    setCurrentProject(project, adminUserId);
    // Create the class first via the same route that the UI uses.
    const create = await fetch(`${baseUrl}/api/codegen/test-class`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ className: "ChromeOpens" }),
    });
    expect(create.status).toBe(201);
    const { message: classFile } = (await create.json()) as { message: string };

    const res = await fetch(`${baseUrl}/api/codegen/test-method`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ filePath: classFile, methodName: "OpensSite" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rejects an unknown filePath with 400", async () => {
    const project = await createProject({
      solutionName: "CGMSlnB",
      namespace: "CGMB.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/codegen/test-method`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        filePath: "Tests/DoesNotExist.cs",
        methodName: "Whatever",
      }),
    });
    expect(res.status).toBe(400);
  });
});

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

const ADMIN_USERNAME = "vitest-files-admin";
const LIMITED_USERNAME = "vitest-files-limited";

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
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-filesroutes-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("/api/files (CRUD)", () => {
  it("returns 404 on GET when no project is loaded", async () => {
    setCurrentProject(null, adminUserId);
    const res = await fetch(`${baseUrl}/api/files?path=Whatever.cs`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(404);
  });

  it("creates, reads, updates, renames, and deletes a file (admin)", async () => {
    const project = await createProject({
      solutionName: "FCRUD",
      namespace: "FCRUD.QA",
    });
    setCurrentProject(project, adminUserId);

    const created = await fetch(`${baseUrl}/api/files`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ path: "Tests/Hello.cs", content: "// hi" }),
    });
    expect(created.status).toBe(201);

    const got = await fetch(
      `${baseUrl}/api/files?path=${encodeURIComponent("Tests/Hello.cs")}`,
      { headers: withCookie(adminCookie) },
    );
    expect(got.status).toBe(200);
    const gotBody = (await got.json()) as { content: string; path: string };
    expect(gotBody.content).toBe("// hi");
    expect(gotBody.path).toBe("Tests/Hello.cs");

    const updated = await fetch(`${baseUrl}/api/files`, {
      method: "PUT",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ path: "Tests/Hello.cs", content: "// hi2" }),
    });
    expect(updated.status).toBe(200);

    const renamed = await fetch(`${baseUrl}/api/files/rename`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        oldPath: "Tests/Hello.cs",
        newPath: "Tests/Hi.cs",
      }),
    });
    expect(renamed.status).toBe(200);

    const deleted = await fetch(
      `${baseUrl}/api/files?path=${encodeURIComponent("Tests/Hi.cs")}`,
      { method: "DELETE", headers: withCookie(adminCookie) },
    );
    expect(deleted.status).toBe(200);
  });

  it("returns 404 reading a missing file under a loaded project", async () => {
    const project = await createProject({
      solutionName: "FNF",
      namespace: "FNF.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(
      `${baseUrl}/api/files?path=${encodeURIComponent("Tests/Missing.cs")}`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("rejects a malformed POST body with 400", async () => {
    const project = await createProject({
      solutionName: "FBad",
      namespace: "FBad.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/files`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a limited (unassigned) user with 403 on POST", async () => {
    const project = await createProject({
      solutionName: "FAuth",
      namespace: "FAuth.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/files`, {
      method: "POST",
      headers: withCookie(limitedCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ path: "Tests/N.cs", content: "" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/folders", () => {
  it("creates a folder under the loaded project", async () => {
    const project = await createProject({
      solutionName: "FldOK",
      namespace: "FldOK.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/folders`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ path: "Tests/SubA" }),
    });
    expect(res.status).toBe(201);
    const stat = await fs.stat(path.join(project.rootPath, "Tests/SubA"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("rejects a malformed body with 400", async () => {
    const project = await createProject({
      solutionName: "FldBad",
      namespace: "FldBad.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/folders`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

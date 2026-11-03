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
import {
  createFork,
  requestFork,
  deleteFork,
  listAllForks,
} from "@/features/forks/infrastructure/forkService";

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedCookie: string;
let limitedAdminCookie: string;
let tmp: string;
let originalWorkspace: string;
let adminUserId = "";
let limitedUserId = "";
let limitedAdminUserId = "";

const ADMIN_USERNAME = "vitest-forks-admin";
const LIMITED_USERNAME = "vitest-forks-limited";
const LIMITED_ADMIN_USERNAME = "vitest-forks-ladmin";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  const limited = await provisionUser({
    username: LIMITED_USERNAME,
    role: "limited",
  });
  limitedUserId = limited.id;
  const limitedAdmin = await provisionUser({
    username: LIMITED_ADMIN_USERNAME,
    role: "limited_admin",
  });
  limitedAdminUserId = limitedAdmin.id;
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
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-forksroutes-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  // Hard-clean any forks that the suite created so the table doesn't
  // accumulate rows across reruns.
  for (const f of await listAllForks()) {
    if (f.username.startsWith("vitest-forks-")) {
      await deleteFork(f.id).catch(() => {});
    }
  }
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("GET /api/forks", () => {
  it("returns the admin's view of all forks", async () => {
    await createProject({
      solutionName: "ForksList",
      namespace: "ForksList.QA",
    });
    await createFork({
      userId: limitedUserId,
      projectName: "ForksList",
      decidedBy: adminUserId,
    });
    const res = await fetch(`${baseUrl}/api/forks`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      projectName: string;
      username: string;
    }>;
    expect(body.find((r) => r.projectName === "ForksList")).toBeDefined();
  });

  it("returns 401 without a session", async () => {
    const res = await fetch(`${baseUrl}/api/forks`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/forks/available-projects", () => {
  it("returns an array for every authenticated user", async () => {
    const res = await fetch(`${baseUrl}/api/forks/available-projects`, {
      headers: withCookie(limitedCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("POST /api/forks (admin assigns)", () => {
  it("creates a fork (admin)", async () => {
    await createProject({
      solutionName: "ForksCreate",
      namespace: "ForksCreate.QA",
    });
    const res = await fetch(`${baseUrl}/api/forks`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        userId: limitedUserId,
        projectName: "ForksCreate",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; projectName: string };
    expect(body.projectName).toBe("ForksCreate");
    expect(body.status).toBe("active");
  });

  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(`${baseUrl}/api/forks`, {
      method: "POST",
      headers: withCookie(limitedCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        userId: limitedUserId,
        projectName: "ForksCreate",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await fetch(`${baseUrl}/api/forks`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/forks/request", () => {
  it("creates a pending fork request for a limited user", async () => {
    await createProject({
      solutionName: "ForksReq",
      namespace: "ForksReq.QA",
    });
    const res = await fetch(`${baseUrl}/api/forks/request`, {
      method: "POST",
      headers: withCookie(limitedCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ projectName: "ForksReq" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("pending");
  });

  it("rejects a request for an unknown project with 400", async () => {
    const res = await fetch(`${baseUrl}/api/forks/request`, {
      method: "POST",
      headers: withCookie(limitedCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ projectName: "NoSuchProject" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/forks/:id/approve and /deny", () => {
  it("approves a pending fork (admin) and denies another", async () => {
    await createProject({
      solutionName: "ForksAD",
      namespace: "ForksAD.QA",
    });
    const pending = await requestFork({
      userId: limitedUserId,
      projectName: "ForksAD",
    });
    const approve = await fetch(
      `${baseUrl}/api/forks/${pending.id}/approve`,
      {
        method: "POST",
        headers: withCookie(adminCookie),
      },
    );
    expect(approve.status).toBe(200);
    const approveBody = (await approve.json()) as { status: string };
    expect(approveBody.status).toBe("active");

    // Make a second pending request from the limited_admin user (limited_admins
    // can technically request a fork too — the route doesn't gate that — but
    // we'll just deny it to exercise the deny path).
    const pending2 = await requestFork({
      userId: limitedAdminUserId,
      projectName: "ForksAD",
    });
    const deny = await fetch(`${baseUrl}/api/forks/${pending2.id}/deny`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    expect(deny.status).toBe(204);
  });

  it("returns 400 on an invalid uuid param", async () => {
    const res = await fetch(`${baseUrl}/api/forks/not-a-uuid/approve`, {
      method: "POST",
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/forks/:id", () => {
  it("deletes a fork (admin)", async () => {
    await createProject({
      solutionName: "ForksDel",
      namespace: "ForksDel.QA",
    });
    const fork = await createFork({
      userId: limitedUserId,
      projectName: "ForksDel",
      decidedBy: adminUserId,
    });
    const res = await fetch(`${baseUrl}/api/forks/${fork.id}`, {
      method: "DELETE",
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(204);
  });

  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(
      `${baseUrl}/api/forks/00000000-0000-0000-0000-000000000000`,
      {
        method: "DELETE",
        headers: withCookie(limitedAdminCookie),
      },
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/forks/:id/submit", () => {
  it("submits a fork for SDET review (admin)", async () => {
    await createProject({
      solutionName: "ForksSubOK",
      namespace: "ForksSubOK.QA",
    });
    const fork = await createFork({
      userId: adminUserId,
      projectName: "ForksSubOK",
      decidedBy: adminUserId,
    });
    const res = await fetch(`${baseUrl}/api/forks/${fork.id}/submit`, {
      method: "POST",
      headers: withCookie(adminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ comment: "ready for review" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      forkId: string;
      status: string;
      submitterComment: string | null;
    };
    expect(body.forkId).toBe(fork.id);
    expect(body.status).toBe("pending");
    expect(body.submitterComment).toBe("ready for review");
  });

  it("returns 404 for an unknown fork id", async () => {
    const res = await fetch(
      `${baseUrl}/api/forks/00000000-0000-0000-0000-000000000000/submit`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(404);
  });

  it("rejects a non-owner non-admin caller with 403", async () => {
    await createProject({
      solutionName: "ForksSub",
      namespace: "ForksSub.QA",
    });
    const fork = await createFork({
      userId: limitedUserId,
      projectName: "ForksSub",
      decidedBy: adminUserId,
    });
    const res = await fetch(`${baseUrl}/api/forks/${fork.id}/submit`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/forks/by-project/:projectName", () => {
  it("returns { fork: null } when the user has none", async () => {
    const res = await fetch(
      `${baseUrl}/api/forks/by-project/Nope`,
      { headers: withCookie(limitedCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fork: unknown };
    expect(body.fork).toBeNull();
  });

  it("returns the matching fork for the owning user", async () => {
    await createProject({
      solutionName: "ForksByProj",
      namespace: "ForksByProj.QA",
    });
    await createFork({
      userId: limitedUserId,
      projectName: "ForksByProj",
      decidedBy: adminUserId,
    });
    const res = await fetch(
      `${baseUrl}/api/forks/by-project/ForksByProj`,
      { headers: withCookie(limitedCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      fork: { projectName: string } | null;
    };
    expect(body.fork?.projectName).toBe("ForksByProj");
  });
});

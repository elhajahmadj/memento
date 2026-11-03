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
  deleteFork,
  listAllForks,
} from "@/features/forks/infrastructure/forkService";
import { createSubmissionFromFork } from "@/features/approvals/infrastructure/approvalService";

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedCookie: string;
let limitedAdminCookie: string;
let tmp: string;
let originalWorkspace: string;
let adminUserId = "";
let limitedUserId = "";
let _limitedAdminUserId = "";

const ADMIN_USERNAME = "vitest-appr-admin";
const LIMITED_USERNAME = "vitest-appr-limited";
const LIMITED_ADMIN_USERNAME = "vitest-appr-ladmin";

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
  _limitedAdminUserId = limitedAdmin.id;
  void _limitedAdminUserId;
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
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-apprroutes-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  for (const f of await listAllForks()) {
    if (f.username.startsWith("vitest-appr-")) {
      await deleteFork(f.id).catch(() => {});
    }
  }
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function seedSubmission(): Promise<{
  submissionId: string;
  forkId: string;
  projectName: string;
}> {
  const projectName =
    "ApprProj_" + Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/gi, "x");
  await createProject({
    solutionName: projectName,
    namespace: `${projectName}.QA`,
  });
  const fork = await createFork({
    userId: limitedUserId,
    projectName,
    decidedBy: adminUserId,
  });
  const sub = await createSubmissionFromFork({
    fork,
    submittedBy: limitedUserId,
  });
  return { submissionId: sub.id, forkId: fork.id, projectName };
}

describe("GET /api/approvals/mine", () => {
  it("returns the limited user's own submissions", async () => {
    const { submissionId } = await seedSubmission();
    const res = await fetch(`${baseUrl}/api/approvals/mine`, {
      headers: withCookie(limitedCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.find((r) => r.id === submissionId)).toBeDefined();
  });

  it("returns 401 without a session", async () => {
    const res = await fetch(`${baseUrl}/api/approvals/mine`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/approvals", () => {
  it("returns all submissions to admin (decorated with changedFiles)", async () => {
    const { submissionId } = await seedSubmission();
    const res = await fetch(`${baseUrl}/api/approvals`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      id: string;
      changedFiles: number;
      conflictCount: number;
    }>;
    const found = body.find((r) => r.id === submissionId);
    expect(found).toBeDefined();
    expect(typeof found!.changedFiles).toBe("number");
  });

  it("rejects an invalid status filter with 400", async () => {
    const res = await fetch(`${baseUrl}/api/approvals?status=junk`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a limited (non-admin) caller with 403", async () => {
    const res = await fetch(`${baseUrl}/api/approvals`, {
      headers: withCookie(limitedCookie),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/approvals/:id (and /diff)", () => {
  it("returns the submission to the owning limited user", async () => {
    const { submissionId } = await seedSubmission();
    const res = await fetch(`${baseUrl}/api/approvals/${submissionId}`, {
      headers: withCookie(limitedCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(submissionId);
  });

  it("returns 404 for an unknown submission id", async () => {
    const res = await fetch(
      `${baseUrl}/api/approvals/00000000-0000-0000-0000-000000000000`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("rejects a non-owner non-admin with 403", async () => {
    const { submissionId } = await seedSubmission();
    const res = await fetch(`${baseUrl}/api/approvals/${submissionId}`, {
      headers: withCookie(limitedAdminCookie),
    });
    expect(res.status).toBe(403);
  });

  it("returns the diff (admin)", async () => {
    const { submissionId } = await seedSubmission();
    const res = await fetch(
      `${baseUrl}/api/approvals/${submissionId}/diff`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      files: unknown[];
      conflictCount: number;
    };
    expect(Array.isArray(body.files)).toBe(true);
  });

  it("returns 404 for an unknown file in the diff", async () => {
    const { submissionId } = await seedSubmission();
    const res = await fetch(
      `${baseUrl}/api/approvals/${submissionId}/diff?file=NotInDiff.cs`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/approvals/:id/approve and /reject", () => {
  it("approves a submission (admin)", async () => {
    const { submissionId } = await seedSubmission();
    const res = await fetch(
      `${baseUrl}/api/approvals/${submissionId}/approve`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ comment: "lgtm" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("approved");
  });

  it("rejects a submission (admin)", async () => {
    const { submissionId } = await seedSubmission();
    const res = await fetch(
      `${baseUrl}/api/approvals/${submissionId}/reject`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ comment: "nope" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("rejected");
  });

  it("rejects a non-admin caller with 403 on approve", async () => {
    const { submissionId } = await seedSubmission();
    const res = await fetch(
      `${baseUrl}/api/approvals/${submissionId}/approve`,
      {
        method: "POST",
        headers: withCookie(limitedCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid uuid", async () => {
    const res = await fetch(`${baseUrl}/api/approvals/not-uuid/approve`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

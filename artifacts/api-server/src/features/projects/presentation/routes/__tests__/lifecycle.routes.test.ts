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
  createPendingCreateRequest,
  getLifecycleRequestById,
} from "@/features/projects/infrastructure/projectLifecycleRequestService";
import {
  createClearFilesRequest,
  getPendingClearFilesRequestForProject,
} from "@/features/projects/infrastructure/lifecycleRequestService";
import {
  db,
  projectAssignmentsTable,
  projectLifecycleRequestsTable,
  projectOrganizationsTable,
  usersTable,
} from "@workspace/db";
import { inArray, like } from "drizzle-orm";

const USERNAMES = [
  "vitest-lr-admin",
  "vitest-lr-requester",
  "vitest-lr-other",
  "vitest-lr-limited",
];

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let requesterCookie: string;
let otherCookie: string;
let adminId = "";
let requesterId = "";
let _otherId = "";
let limitedId = "";
let limitedCookie: string;
let tmp: string;
let originalWorkspace: string;

async function cleanupRows(): Promise<void> {
  await db
    .delete(projectLifecycleRequestsTable)
    .where(like(projectLifecycleRequestsTable.projectName, "VitestLR%"));
  await db
    .delete(projectAssignmentsTable)
    .where(like(projectAssignmentsTable.projectName, "VitestLR%"));
  await db
    .delete(projectOrganizationsTable)
    .where(like(projectOrganizationsTable.projectName, "VitestLR%"));
}

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  await db.delete(usersTable).where(inArray(usersTable.username, USERNAMES));
  const admin = await provisionUser({ username: USERNAMES[0]!, role: "admin" });
  const requester = await provisionUser({
    username: USERNAMES[1]!,
    role: "limited_admin",
  });
  const other = await provisionUser({
    username: USERNAMES[2]!,
    role: "limited_admin",
  });
  const limited = await provisionUser({
    username: USERNAMES[3]!,
    role: "limited",
  });
  adminId = admin.id;
  requesterId = requester.id;
  _otherId = other.id;
  void _otherId;
  limitedId = limited.id;
  adminCookie = await login(baseUrl, USERNAMES[0]!);
  requesterCookie = await login(baseUrl, USERNAMES[1]!);
  otherCookie = await login(baseUrl, USERNAMES[2]!);
  limitedCookie = await login(baseUrl, USERNAMES[3]!);
});

afterAll(async () => {
  await cleanupRows();
  for (const u of USERNAMES) await deleteUserByUsername(u);
  await close();
}, 30_000);

beforeEach(async () => {
  await cleanupRows();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-lr-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  setCurrentProject(null, adminId);
  setCurrentProject(null, requesterId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("Lifecycle request HTTP routes", () => {
  it("GET /projects/lifecycle-requests returns the caller's own requests by default for non-admins", async () => {
    const req = await createPendingCreateRequest({
      projectName: "VitestLRMine",
      requestedByUserId: requesterId,
      requestedByRole: "limited_admin",
      organizationId: null,
    });
    const res = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests?status=pending`,
      { headers: withCookie(requesterCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((r) => r.id === req.id)).toBe(true);
  });

  it("Admin approve transitions the request to approved and assigns the requester", async () => {
    // Scaffold a project on disk so cleanup paths are reachable.
    const project = await createProject({
      solutionName: "VitestLRApprove",
      namespace: "VitestLRApprove.QA",
    });
    const req = await createPendingCreateRequest({
      projectName: project.solutionName,
      requestedByUserId: requesterId,
      requestedByRole: "limited_admin",
      organizationId: null,
    });
    const res = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${req.id}/approve`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("approved");

    const refreshed = await getLifecycleRequestById(req.id);
    expect(refreshed?.status).toBe("approved");

    // Requester (limited_admin) now has an assignment.
    const assignments = await db
      .select()
      .from(projectAssignmentsTable)
      .where(inArray(projectAssignmentsTable.userId, [requesterId]));
    expect(
      assignments.find((a) => a.projectName === project.solutionName),
    ).toBeTruthy();
  });

  it("Admin reject cleans up the scaffolded project and marks the request rejected", async () => {
    const project = await createProject({
      solutionName: "VitestLRReject",
      namespace: "VitestLRReject.QA",
    });
    const req = await createPendingCreateRequest({
      projectName: project.solutionName,
      requestedByUserId: requesterId,
      requestedByRole: "limited_admin",
      organizationId: null,
    });
    const res = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${req.id}/reject`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ note: "not now" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; decisionNote: string };
    expect(body.status).toBe("rejected");
    expect(body.decisionNote).toBe("not now");

    // Scaffold directory should be gone (best-effort cleanup).
    const projectDirGone = await fs
      .stat(path.dirname(project.slnPath))
      .then(() => false)
      .catch(() => true);
    expect(projectDirGone).toBe(true);
  });

  it("Admin cannot approve a non-pending request", async () => {
    const req = await createPendingCreateRequest({
      projectName: "VitestLRTwice",
      requestedByUserId: requesterId,
      requestedByRole: "limited_admin",
      organizationId: null,
    });
    const first = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${req.id}/approve`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({}),
      },
    );
    expect(first.status).toBe(200);
    const second = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${req.id}/approve`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({}),
      },
    );
    expect(second.status).toBe(400);
  });

  it("Non-admin caller cannot approve", async () => {
    const req = await createPendingCreateRequest({
      projectName: "VitestLRDeny",
      requestedByUserId: requesterId,
      requestedByRole: "limited_admin",
      organizationId: null,
    });
    const res = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${req.id}/approve`,
      {
        method: "POST",
        headers: withCookie(requesterCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(403);
  });

  it("Requester can cancel their own pending request", async () => {
    const req = await createPendingCreateRequest({
      projectName: "VitestLRCancel",
      requestedByUserId: requesterId,
      requestedByRole: "limited_admin",
      organizationId: null,
    });
    const res = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${req.id}`,
      { method: "DELETE", headers: withCookie(requesterCookie) },
    );
    expect(res.status).toBe(204);
    expect(await getLifecycleRequestById(req.id)).toBeNull();
  });

  it("Non-requester cannot cancel someone else's request", async () => {
    const req = await createPendingCreateRequest({
      projectName: "VitestLRCancelDeny",
      requestedByUserId: requesterId,
      requestedByRole: "limited_admin",
      organizationId: null,
    });
    const res = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${req.id}`,
      { method: "DELETE", headers: withCookie(otherCookie) },
    );
    expect(res.status).toBe(403);
    expect(await getLifecycleRequestById(req.id)).not.toBeNull();
  });

  it("Pending project cannot be loaded even by the requester", async () => {
    const project = await createProject({
      solutionName: "VitestLRPendingLoad",
      namespace: "VitestLRPendingLoad.QA",
    });
    await createPendingCreateRequest({
      projectName: project.solutionName,
      requestedByUserId: requesterId,
      requestedByRole: "limited_admin",
      organizationId: null,
    });
    // Assign the requester so the only thing blocking is the pending guard.
    await db
      .insert(projectAssignmentsTable)
      .values({
        userId: requesterId,
        projectName: project.solutionName,
        assignedBy: adminId,
      })
      .onConflictDoNothing();

    const res = await fetch(`${baseUrl}/api/projects/load`, {
      method: "POST",
      headers: withCookie(requesterCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ slnPath: project.slnPath }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/awaiting admin approval/i);
  });

  it("Approving a limited (User-role) requester creates a project_assignments row so the user can load the project", async () => {
    const project = await createProject({
      solutionName: "VitestLRUserApprove",
      namespace: "VitestLRUserApprove.QA",
    });
    const req = await createPendingCreateRequest({
      projectName: project.solutionName,
      requestedByUserId: limitedId,
      requestedByRole: "limited",
      organizationId: null,
    });
    const res = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${req.id}/approve`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("approved");
    const assignments = await db
      .select()
      .from(projectAssignmentsTable)
      .where(inArray(projectAssignmentsTable.userId, [limitedId]));
    // Limited (User-role) requesters must get assignment access on
    // approval so they can load the project they asked for.
    expect(
      assignments.find((a) => a.projectName === project.solutionName),
    ).toBeTruthy();

    // And the load endpoint must actually honor that assignment.
    const loadRes = await fetch(`${baseUrl}/api/projects/load`, {
      method: "POST",
      headers: withCookie(limitedCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ slnPath: project.slnPath }),
    });
    expect(loadRes.status).toBe(200);
  });

  it("A limited (User-role) requester can cancel their own pending request", async () => {
    const req = await createPendingCreateRequest({
      projectName: "VitestLRUserCancel",
      requestedByUserId: limitedId,
      requestedByRole: "limited",
      organizationId: null,
    });
    const res = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${req.id}`,
      { method: "DELETE", headers: withCookie(limitedCookie) },
    );
    expect(res.status).toBe(204);
    expect(await getLifecycleRequestById(req.id)).toBeNull();
  });

  it("clear_files: approve removes recorded artifacts on disk; reject leaves them intact", async () => {
    // Helper: write a sentinel test class into the C# scaffold's
    // `Tests/` directory — clearCsharpFiles wipes the contents of that
    // dir, so the sentinel is the canonical proof that "clear" ran.
    const writeSentinel = async (
      projectRoot: string,
      testProjectName: string,
    ): Promise<string> => {
      const sentinel = path.join(
        projectRoot,
        testProjectName,
        "Tests",
        "SentinelClearTest.cs",
      );
      await fs.mkdir(path.dirname(sentinel), { recursive: true });
      await fs.writeFile(sentinel, "// recorded by user\n");
      return sentinel;
    };
    const exists = (p: string) =>
      fs.stat(p).then(() => true).catch(() => false);

    // --- Approve path: sentinel must be gone. ------------------------
    const projA = await createProject({
      solutionName: "VitestLRClearApprove",
      namespace: "VitestLRClearApprove.QA",
    });
    const projARoot = path.dirname(projA.slnPath);
    const sentinelA = await writeSentinel(
      projARoot,
      `${projA.solutionName}.Tests`,
    );
    expect(await exists(sentinelA)).toBe(true);

    const reqA = await createClearFilesRequest({
      projectName: projA.solutionName,
      organizationId: null,
      requestedByUserId: requesterId,
      requestedByRole: "limited_admin",
    });
    const approveRes = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${reqA.id}/approve`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({}),
      },
    );
    expect(approveRes.status).toBe(200);
    expect((await approveRes.json() as { status: string }).status).toBe("approved");
    expect((await getLifecycleRequestById(reqA.id))?.status).toBe("approved");
    // The recorded artifact was wiped, but the scaffolded skeleton
    // (sln file) stayed put.
    expect(await exists(sentinelA)).toBe(false);
    expect(await exists(projA.slnPath)).toBe(true);

    // --- Reject path: sentinel must remain. --------------------------
    const projB = await createProject({
      solutionName: "VitestLRClearReject",
      namespace: "VitestLRClearReject.QA",
    });
    const projBRoot = path.dirname(projB.slnPath);
    const sentinelB = await writeSentinel(
      projBRoot,
      `${projB.solutionName}.Tests`,
    );
    expect(await exists(sentinelB)).toBe(true);

    const reqB = await createClearFilesRequest({
      projectName: projB.solutionName,
      organizationId: null,
      requestedByUserId: requesterId,
      requestedByRole: "limited_admin",
    });
    const rejectRes = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${reqB.id}/reject`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ note: "not yet" }),
      },
    );
    expect(rejectRes.status).toBe(200);
    expect((await rejectRes.json() as { status: string }).status).toBe("rejected");
    expect(
      await getPendingClearFilesRequestForProject(projB.solutionName),
    ).toBeNull();
    // Reject must NOT clear files — sentinel is still there.
    expect(await exists(sentinelB)).toBe(true);
    expect(await exists(projB.slnPath)).toBe(true);
  });

  it("clear_files: requester cannot approve their own clear-files request", async () => {
    const project = await createProject({
      solutionName: "VitestLRClearSelf",
      namespace: "VitestLRClearSelf.QA",
    });
    const req = await createClearFilesRequest({
      projectName: project.solutionName,
      organizationId: null,
      requestedByUserId: adminId,
      requestedByRole: "admin",
    });
    const res = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${req.id}/approve`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(403);
    const refreshed = await getLifecycleRequestById(req.id);
    expect(refreshed?.status).toBe("pending");
  });

  it("clear_files: approve fails with 409 when target project no longer exists; request stays pending", async () => {
    const req = await createClearFilesRequest({
      projectName: "VitestLRClearMissing",
      organizationId: null,
      requestedByUserId: requesterId,
      requestedByRole: "limited_admin",
    });
    const res = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${req.id}/approve`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(409);
    const refreshed = await getLifecycleRequestById(req.id);
    expect(refreshed?.status).toBe("pending");
  });

  it("Admin's /projects/available hides pending-create projects (admins use the queue)", async () => {
    const project = await createProject({
      solutionName: "VitestLRHidden",
      namespace: "VitestLRHidden.QA",
    });
    await createPendingCreateRequest({
      projectName: project.solutionName,
      requestedByUserId: requesterId,
      requestedByRole: "limited_admin",
      organizationId: null,
    });
    const res = await fetch(`${baseUrl}/api/projects/available`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ solutionName: string }>;
    expect(
      body.find((p) => p.solutionName === project.solutionName),
    ).toBeFalsy();
  });
});

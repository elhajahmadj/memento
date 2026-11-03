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
import { createAssignment } from "@/features/assignments/infrastructure/assignmentService";
import { createFork } from "@/features/forks/infrastructure/forkService";
import {
  db,
  forksTable,
  projectAssignmentsTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";

const TEST_USERNAMES = [
  "vitest-projroutes-admin",
  "vitest-projroutes-ladmin",
  "vitest-projroutes-limited",
];

// Strip any project_assignments / forks rows that still reference the
// previous incarnations of our test users (e.g. left over from an
// aborted test run). Without this, `provisionUser` -> `db.delete(users)`
// fails with a `assigned_by` / `decided_by` FK constraint.
async function scrubTestUserFkRows(): Promise<void> {
  const stale = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.username, TEST_USERNAMES));
  if (stale.length === 0) return;
  const ids = stale.map((u) => u.id);
  await db
    .delete(projectAssignmentsTable)
    .where(
      or(
        inArray(projectAssignmentsTable.userId, ids),
        inArray(projectAssignmentsTable.assignedBy, ids),
      ),
    );
  await db
    .delete(forksTable)
    .where(
      or(
        inArray(forksTable.userId, ids),
        inArray(forksTable.decidedBy, ids),
      ),
    );
}

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedAdminCookie: string;
let limitedCookie: string;
let tmp: string;
let originalWorkspace: string;
let adminUserId = "";
let limitedAdminUserId = "";
let limitedUserId = "";

const ADMIN_USERNAME = "vitest-projroutes-admin";
const LIMITED_ADMIN_USERNAME = "vitest-projroutes-ladmin";
const LIMITED_USERNAME = "vitest-projroutes-limited";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  await scrubTestUserFkRows();
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  const limitedAdmin = await provisionUser({
    username: LIMITED_ADMIN_USERNAME,
    role: "limited_admin",
  });
  limitedAdminUserId = limitedAdmin.id;
  const limited = await provisionUser({
    username: LIMITED_USERNAME,
    role: "limited",
  });
  limitedUserId = limited.id;
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedAdminCookie = await login(baseUrl, LIMITED_ADMIN_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);
});

afterAll(async () => {
  // Clean up rows that reference our test users via FK before deleting
  // the users themselves; otherwise the user delete fails with a
  // `assigned_by` / `decided_by` constraint violation.
  // Hook timeout bumped to 30s — under heavy parallel-fork load the
  // shared Postgres can take longer than the default 10s for the
  // cascade-aware cleanup chain below to complete.
  await db
    .delete(projectAssignmentsTable)
    .where(
      or(
        eq(projectAssignmentsTable.userId, limitedAdminUserId),
        eq(projectAssignmentsTable.assignedBy, adminUserId),
      ),
    );
  await db
    .delete(forksTable)
    .where(
      or(
        eq(forksTable.userId, limitedUserId),
        eq(forksTable.decidedBy, adminUserId),
      ),
    );
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await close();
}, 30_000);

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-projroutes-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("GET /api/projects/current", () => {
  it("returns null when no project is loaded for the caller", async () => {
    const res = await fetch(`${baseUrl}/api/projects/current`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: unknown };
    expect(body.project).toBeNull();
  });

  it("returns the loaded project when one is set for the caller", async () => {
    const project = await createProject({
      solutionName: "ProjA",
      namespace: "ProjA.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/projects/current`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      project: { solutionName: string } | null;
    };
    expect(body.project?.solutionName).toBe("ProjA");
  });
});

describe("POST /api/projects (create)", () => {
  it("creates a project (admin) and makes it current", async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        solutionName: "RouteCreated",
        testProjectName: "RouteCreated.Tests",
        namespace: "RouteCreated.QA",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { solutionName: string };
    expect(body.solutionName).toBe("RouteCreated");
  });

  // Local users (authSource=local, policy=all) preserve pre-existing
  // behavior: only admins/memento-admins may create projects. The new
  // pending-approval flow is gated on org-scoped (OIDC) users.
  it("rejects a local non-admin caller with 403 (policy=all)", async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        solutionName: "LocalLimAdminDenied",
        testProjectName: "LocalLimAdminDenied.Tests",
        namespace: "LocalLimAdminDenied.QA",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid solution name with 400", async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        solutionName: "../bad",
        testProjectName: "X.Tests",
        namespace: "X.QA",
      }),
    });
    expect(res.status).toBe(400);
  });

  // Regression: the route used to strip `architectureId` whenever the
  // caller asked for an API solution, which silently bypassed any
  // user-authored API architecture. The route must now pass the
  // architectureId straight through so the service can scaffold from
  // the custom layout and re-stamp the marker as solutionType=api.
  it("scaffolds a custom API architecture end-to-end via POST /api/projects", async () => {
    // Persist a custom API architecture via the public upsert route so
    // we exercise the same flow the UI uses.
    const archCreate = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: withCookie(adminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        id: "route-custom-api",
        name: "Route Custom API",
        isBuiltIn: false,
        language: "csharp",
        solutionType: "api",
        projects: [
          {
            id: "p-tests",
            nameSuffix: ".ApiTests",
            isTestsProject: true,
            slnGuid: "{00000000-0000-0000-0000-0000000000ee}",
            files: [
              {
                name: "Marker.cs",
                content:
                  "namespace {{Namespace}}.ApiTests; public class Marker { public const string Sln = \"{{Solution}}\"; }",
              },
            ],
            folders: [],
          },
        ],
      }),
    });
    expect(archCreate.status).toBe(200);

    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: withCookie(adminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        solutionName: "RouteApiSln",
        testProjectName: "RouteApiSln.ApiTests",
        namespace: "RouteApi.QA",
        language: "csharp",
        solutionType: "api",
        architectureId: "route-custom-api",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      solutionName: string;
      solutionType: string;
      rootPath: string;
    };
    expect(body.solutionName).toBe("RouteApiSln");
    expect(body.solutionType).toBe("api");

    // The user's custom file landed on disk with token substitution.
    const tested = await fs.readFile(
      path.join(body.rootPath, "RouteApiSln.ApiTests", "Marker.cs"),
      "utf8",
    );
    expect(tested).toContain("namespace RouteApi.QA.ApiTests;");
    expect(tested).toContain('"RouteApiSln"');

    // Marker reflects the user's chosen custom architecture id and
    // the API flavor — proving the route preserved architectureId
    // instead of stripping it back to undefined.
    const marker = JSON.parse(
      await fs.readFile(
        path.join(body.rootPath, ".testbuilder.json"),
        "utf8",
      ),
    );
    expect(marker.architectureId).toBe("route-custom-api");
    expect(marker.solutionType).toBe("api");
  });
});

describe("POST /api/projects/load", () => {
  it("loads an admin's project from a workspace path", async () => {
    const project = await createProject({
      solutionName: "Loadable",
      namespace: "Loadable.QA",
    });
    const res = await fetch(`${baseUrl}/api/projects/load`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ slnPath: project.slnPath }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { solutionName: string };
    expect(body.solutionName).toBe("Loadable");
  });

  it("returns 403 for a limited_admin without an assignment", async () => {
    const project = await createProject({
      solutionName: "Restricted",
      namespace: "Restricted.QA",
    });
    const res = await fetch(`${baseUrl}/api/projects/load`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ slnPath: project.slnPath }),
    });
    expect(res.status).toBe(403);
  });

  // Regression for task-183: an admin loading a non-C# API-architecture
  // project (Python/Node.js/Java) must NOT be forced through the
  // limited-user "you do not have an active fork" branch. Admins never
  // need a fork, regardless of the project's language or solutionType.
  it("loads an admin's API-architecture (Node.js) project without a fork", async () => {
    const project = await createProject({
      solutionName: "AdminApiNode",
      namespace: "AdminApiNode",
      language: "nodejs",
      solutionType: "api",
    });
    expect(project.solutionType).toBe("api");
    expect(project.language).toBe("nodejs");
    // Sanity-check the slnPath: it points at the language-specific
    // marker file (`package.json`), not a `.sln`. The load handler
    // must canonicalize this for org/assignment checks instead of
    // mis-classifying it as "not a project" and falling through to
    // the fork-required branch.
    expect(project.slnPath.endsWith("/package.json")).toBe(true);
    const res = await fetch(`${baseUrl}/api/projects/load`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ slnPath: project.slnPath }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      solutionName: string;
      language: string;
      solutionType: string;
    };
    expect(body.solutionName).toBe("AdminApiNode");
    expect(body.language).toBe("nodejs");
    expect(body.solutionType).toBe("api");
  });

  it("rejects a malformed body with 400", async () => {
    const res = await fetch(`${baseUrl}/api/projects/load`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/projects/available", () => {
  it("returns all main solutions for an admin", async () => {
    await createProject({
      solutionName: "Listed",
      namespace: "Listed.QA",
    });
    const res = await fetch(`${baseUrl}/api/projects/available`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ solutionName: string }>;
    expect(body.find((p) => p.solutionName === "Listed")).toBeDefined();
  });

  it("returns an empty array for a limited user", async () => {
    const res = await fetch(`${baseUrl}/api/projects/available`, {
      headers: withCookie(limitedCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toEqual([]);
  });
});

describe("POST /api/projects/disable", () => {
  it("toggles the disabled flag on a project (admin)", async () => {
    const project = await createProject({
      solutionName: "Toggleable",
      namespace: "Toggleable.QA",
    });
    const res = await fetch(`${baseUrl}/api/projects/disable`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ slnPath: project.slnPath, disabled: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { disabled: boolean };
    expect(body.disabled).toBe(true);
  });

  it("returns 403 for a limited_admin not assigned to the project", async () => {
    const project = await createProject({
      solutionName: "Restricted2",
      namespace: "Restricted2.QA",
    });
    const res = await fetch(`${baseUrl}/api/projects/disable`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ slnPath: project.slnPath, disabled: true }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/projects/delete", () => {
  // The seeded `Admin` user (created by `seedUsers()` at server boot)
  // would otherwise make the test admin non-sole. Other test files that
  // run in parallel against the shared DB can also provision admin
  // users between when this suite starts and when an individual sole-
  // admin assertion runs (task #44). Re-establish the invariant in
  // beforeEach so the snapshot is taken right before the assertion,
  // then restore in afterEach so we don't strip admin from a peer file
  // that's relying on it.
  let demotedIds: string[] = [];
  beforeEach(async () => {
    const { db, usersTable, eq, and, ne } = await (async () => {
      const dbMod = await import("@workspace/db");
      const drz = await import("drizzle-orm");
      return { db: dbMod.db, usersTable: dbMod.usersTable, ...drz };
    })();
    const extras = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "admin"), ne(usersTable.id, adminUserId)));
    demotedIds = [];
    for (const u of extras) {
      await db
        .update(usersTable)
        .set({ role: "memento_admin" })
        .where(eq(usersTable.id, u.id));
      demotedIds.push(u.id);
    }
  });
  afterEach(async () => {
    const { db, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    for (const id of demotedIds) {
      await db
        .update(usersTable)
        .set({ role: "admin" })
        .where(eq(usersTable.id, id));
    }
    demotedIds = [];
  });

  it("deletes a project directory immediately when the caller is the sole admin (acknowledgeIrreversible)", async () => {
    const project = await createProject({
      solutionName: "Doomed",
      namespace: "Doomed.QA",
    });
    const res = await fetch(`${baseUrl}/api/projects/delete`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        slnPath: project.slnPath,
        acknowledgeIrreversible: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "deleted", requestId: null });
    const stat = await fs.stat(project.rootPath).catch(() => null);
    expect(stat).toBeNull();
  });

  it("rejects sole-admin delete without acknowledgeIrreversible with 400", async () => {
    const project = await createProject({
      solutionName: "DoomedNoAck",
      namespace: "DoomedNoAck.QA",
    });
    const res = await fetch(`${baseUrl}/api/projects/delete`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ slnPath: project.slnPath }),
    });
    expect(res.status).toBe(400);
    const stat = await fs.stat(project.rootPath).catch(() => null);
    expect(stat).not.toBeNull();
  });

  it("limited_admin filing a delete request creates a pending lifecycle row", async () => {
    const project = await createProject({
      solutionName: "PendingTarget",
      namespace: "PendingTarget.QA",
    });
    const res = await fetch(`${baseUrl}/api/projects/delete`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ slnPath: project.slnPath }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; requestId: string };
    expect(body.status).toBe("pending");
    expect(typeof body.requestId).toBe("string");
    // Project files must still be present until an admin approves.
    const stat = await fs.stat(project.rootPath).catch(() => null);
    expect(stat).not.toBeNull();
    // Cleanup the pending row and the project on disk.
    const { db, projectLifecycleRequestsTable } = await import(
      "@workspace/db"
    );
    await db.delete(projectLifecycleRequestsTable);
    await fs.rm(project.rootPath, { recursive: true, force: true });
  });

  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(`${baseUrl}/api/projects/delete`, {
      method: "POST",
      headers: withCookie(limitedCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ slnPath: path.join(tmp, "Whatever.sln") }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await fetch(`${baseUrl}/api/projects/delete`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("blocks duplicate concurrent delete requests with 409", async () => {
    const project = await createProject({
      solutionName: "DupTarget",
      namespace: "DupTarget.QA",
    });
    // First call from sole admin deletes immediately; create a second
    // project + a fake pending request via the lifecycle table to assert
    // the 409 branch.
    const project2 = await createProject({
      solutionName: "DupTarget2",
      namespace: "DupTarget2.QA",
    });
    const { db, projectLifecycleRequestsTable } = await import(
      "@workspace/db"
    );
    await db.insert(projectLifecycleRequestsTable).values({
      projectName: project2.solutionName,
      kind: "delete",
      organizationId: null,
      requestedByUserId: adminUserId,
      requestedByRole: "admin",
    });
    const res = await fetch(`${baseUrl}/api/projects/delete`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        slnPath: project2.slnPath,
        acknowledgeIrreversible: true,
      }),
    });
    expect(res.status).toBe(409);
    // Cleanup: clear the pending row and the project on disk.
    await db.delete(projectLifecycleRequestsTable);
    await fs.rm(project.rootPath, { recursive: true, force: true });
    await fs.rm(project2.rootPath, { recursive: true, force: true });
  });
});

describe("GET /api/projects/delete-preflight", () => {
  const demotedIds: string[] = [];
  beforeAll(async () => {
    const { db, usersTable } = await import("@workspace/db");
    const { eq, and, ne } = await import("drizzle-orm");
    const extras = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "admin"), ne(usersTable.id, adminUserId)));
    for (const u of extras) {
      await db
        .update(usersTable)
        .set({ role: "memento_admin" })
        .where(eq(usersTable.id, u.id));
      demotedIds.push(u.id);
    }
  });
  afterAll(async () => {
    const { db, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    for (const id of demotedIds) {
      await db
        .update(usersTable)
        .set({ role: "admin" })
        .where(eq(usersTable.id, id));
    }
  });

  it("reports isSoleAdmin=true in single-admin local install", async () => {
    const project = await createProject({
      solutionName: "PreflightTarget",
      namespace: "PreflightTarget.QA",
    });
    const url = `${baseUrl}/api/projects/${encodeURIComponent(project.solutionName)}/delete-preflight`;
    const res = await fetch(url, { headers: withCookie(adminCookie) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      requiresApproval: false,
      isSoleAdmin: true,
      hasPendingRequest: false,
    });
    await fs.rm(project.rootPath, { recursive: true, force: true });
  });
});

describe("GET /api/projects/lifecycle-requests", () => {
  it("returns an empty list when there are no pending requests", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests?status=pending`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("POST /api/projects/lifecycle-requests/:id/approve | reject", () => {
  it("limited_admin request → admin approve removes the project from disk", async () => {
    const project = await createProject({
      solutionName: "ApproveFlow",
      namespace: "ApproveFlow.QA",
    });
    // limited_admin files the request
    const filed = await fetch(`${baseUrl}/api/projects/delete`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ slnPath: project.slnPath }),
    });
    expect(filed.status).toBe(200);
    const filedBody = (await filed.json()) as {
      status: string;
      requestId: string;
    };
    expect(filedBody.status).toBe("pending");
    // admin approves (different user than requester → allowed)
    const approved = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${filedBody.requestId}/approve`,
      { method: "POST", headers: withCookie(adminCookie) },
    );
    expect(approved.status).toBe(200);
    const stat = await fs.stat(project.rootPath).catch(() => null);
    expect(stat).toBeNull();
    const { db, projectLifecycleRequestsTable } = await import(
      "@workspace/db"
    );
    await db.delete(projectLifecycleRequestsTable);
  });

  it("limited_admin request → admin reject keeps the project on disk", async () => {
    const project = await createProject({
      solutionName: "RejectFlow",
      namespace: "RejectFlow.QA",
    });
    const filed = await fetch(`${baseUrl}/api/projects/delete`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ slnPath: project.slnPath }),
    });
    const filedBody = (await filed.json()) as { requestId: string };
    const rejected = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${filedBody.requestId}/reject`,
      { method: "POST", headers: withCookie(adminCookie) },
    );
    expect(rejected.status).toBe(200);
    const stat = await fs.stat(project.rootPath).catch(() => null);
    expect(stat).not.toBeNull();
    const { db, projectLifecycleRequestsTable } = await import(
      "@workspace/db"
    );
    await db.delete(projectLifecycleRequestsTable);
    await fs.rm(project.rootPath, { recursive: true, force: true });
  });

  it("requester cannot approve their own request (403)", async () => {
    const project = await createProject({
      solutionName: "SelfApprove",
      namespace: "SelfApprove.QA",
    });
    const filed = await fetch(`${baseUrl}/api/projects/delete`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ slnPath: project.slnPath }),
    });
    const filedBody = (await filed.json()) as { requestId: string };
    const selfApprove = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${filedBody.requestId}/approve`,
      { method: "POST", headers: withCookie(limitedAdminCookie) },
    );
    // limited_admin can't approve at all (requires admin role) → 403
    expect(selfApprove.status).toBe(403);
    const stat = await fs.stat(project.rootPath).catch(() => null);
    expect(stat).not.toBeNull();
    const { db, projectLifecycleRequestsTable } = await import(
      "@workspace/db"
    );
    await db.delete(projectLifecycleRequestsTable);
    await fs.rm(project.rootPath, { recursive: true, force: true });
  });

  it("admin cannot approve their own pending delete request (403)", async () => {
    // Make the test admin non-sole by ensuring at least 2 admins remain.
    // The seeded "Admin" user is present at this point (this describe
    // block does not demote it). The test admin files a delete; the
    // approve call from the same admin must be rejected.
    const project = await createProject({
      solutionName: "AdminSelfApprove",
      namespace: "AdminSelfApprove.QA",
    });
    const filed = await fetch(`${baseUrl}/api/projects/delete`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ slnPath: project.slnPath }),
    });
    expect(filed.status).toBe(200);
    const filedBody = (await filed.json()) as {
      status: string;
      requestId: string;
    };
    expect(filedBody.status).toBe("pending");
    const selfApprove = await fetch(
      `${baseUrl}/api/projects/lifecycle-requests/${filedBody.requestId}/approve`,
      { method: "POST", headers: withCookie(adminCookie) },
    );
    expect(selfApprove.status).toBe(403);
    const stat = await fs.stat(project.rootPath).catch(() => null);
    expect(stat).not.toBeNull();
    const { db, projectLifecycleRequestsTable } = await import(
      "@workspace/db"
    );
    await db.delete(projectLifecycleRequestsTable);
    await fs.rm(project.rootPath, { recursive: true, force: true });
  });
});

describe("GET /api/projects/tree", () => {
  it("returns 404 when no project is loaded", async () => {
    setCurrentProject(null, adminUserId);
    const res = await fetch(`${baseUrl}/api/projects/tree`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(404);
  });

  it("returns the tree for a loaded project (admin)", async () => {
    const project = await createProject({
      solutionName: "Tree",
      namespace: "Tree.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/projects/tree`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; name: string };
    expect(body.type).toBe("folder");
  });
});

describe("GET /api/tests", () => {
  it("returns 404 when no project is loaded", async () => {
    setCurrentProject(null, adminUserId);
    const res = await fetch(`${baseUrl}/api/tests`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(404);
  });

  it("returns an array of test classes for a loaded project", async () => {
    const project = await createProject({
      solutionName: "ListT",
      namespace: "ListT.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/tests`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("GET /api/projects/zip", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await fetch(`${baseUrl}/api/projects/zip`);
    expect(res.status).toBe(401);
  });

  it("returns 404 when no project is loaded", async () => {
    setCurrentProject(null, adminUserId);
    const res = await fetch(`${baseUrl}/api/projects/zip`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(404);
  });

  it("streams a zip with the application/zip content type (current project fallback)", async () => {
    const project = await createProject({
      solutionName: "Zippable",
      namespace: "Zippable.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/projects/zip`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const buf = Buffer.from(await res.arrayBuffer());
    // PK\x03\x04 is the ZIP local-file-header magic.
    expect(buf.subarray(0, 4).toString("hex")).toBe("504b0304");
  });

  it("admin can export any workspace project by slnPath without loading", async () => {
    const project = await createProject({
      solutionName: "AdminZipBySln",
      namespace: "AdminZipBySln.QA",
    });
    // Make sure the admin's "current project" is something else so we
    // know the export targeted the slnPath, not the current.
    setCurrentProject(null, adminUserId);
    const url = `${baseUrl}/api/projects/zip?slnPath=${encodeURIComponent(project.slnPath)}`;
    const res = await fetch(url, { headers: withCookie(adminCookie) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(
      `filename="AdminZipBySln.zip"`,
    );
  });

  it("rejects slnPath outside the workspace folder with 400", async () => {
    const url = `${baseUrl}/api/projects/zip?slnPath=${encodeURIComponent("/etc/passwd")}`;
    const res = await fetch(url, { headers: withCookie(adminCookie) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when slnPath does not match a real workspace project", async () => {
    const fake = path.join(tmp, "no-such", "Ghost.sln");
    const url = `${baseUrl}/api/projects/zip?slnPath=${encodeURIComponent(fake)}`;
    const res = await fetch(url, { headers: withCookie(adminCookie) });
    expect(res.status).toBe(404);
  });

  it("limited admin can export an assigned project by slnPath", async () => {
    const project = await createProject({
      solutionName: "LAdminAssignedZip",
      namespace: "LAdminAssignedZip.QA",
    });
    await createAssignment({
      userId: limitedAdminUserId,
      projectName: project.solutionName,
      assignedBy: adminUserId,
    });
    const url = `${baseUrl}/api/projects/zip?slnPath=${encodeURIComponent(project.slnPath)}`;
    const res = await fetch(url, { headers: withCookie(limitedAdminCookie) });
    expect(res.status).toBe(200);
  });

  it("limited admin gets 403 when exporting a project they are not assigned to", async () => {
    const project = await createProject({
      solutionName: "LAdminUnassignedZip",
      namespace: "LAdminUnassignedZip.QA",
    });
    const url = `${baseUrl}/api/projects/zip?slnPath=${encodeURIComponent(project.slnPath)}`;
    const res = await fetch(url, { headers: withCookie(limitedAdminCookie) });
    expect(res.status).toBe(403);
  });

  it("limited admin cannot exfiltrate an unrelated workspace dir by spoofing the .sln basename", async () => {
    // Real assigned project.
    const assigned = await createProject({
      solutionName: "AssignedSpoof",
      namespace: "AssignedSpoof.QA",
    });
    await createAssignment({
      userId: limitedAdminUserId,
      projectName: assigned.solutionName,
      assignedBy: adminUserId,
    });
    // Unrelated directory inside the workspace, with a crafted file
    // named to match the assigned solution. detectProjectInfo would
    // happily read this and report solutionName="AssignedSpoof", which
    // an unsafe authorization check would accept.
    const evilDir = path.join(tmp, "secret-other-project");
    await fs.mkdir(evilDir, { recursive: true });
    await fs.writeFile(path.join(evilDir, "secrets.txt"), "TOP SECRET");
    const spoofed = path.join(evilDir, `${assigned.solutionName}.sln`);
    await fs.writeFile(spoofed, "");
    const url = `${baseUrl}/api/projects/zip?slnPath=${encodeURIComponent(spoofed)}`;
    const res = await fetch(url, { headers: withCookie(limitedAdminCookie) });
    // Authorization is performed against the *directory name* (the
    // canonical project identity used by createProject and
    // createAssignment), not the .sln basename. The user is assigned
    // to "AssignedSpoof" but the spoofed path lives in
    // "secret-other-project/", so they are unauthorized.
    expect(res.status).toBe(403);
    // And critically, no zip body is streamed.
    expect(res.headers.get("content-type")).not.toBe("application/zip");
  });

  it("limited user gets 403 when exporting a non-fork path", async () => {
    const project = await createProject({
      solutionName: "LimitedNoFork",
      namespace: "LimitedNoFork.QA",
    });
    const url = `${baseUrl}/api/projects/zip?slnPath=${encodeURIComponent(project.slnPath)}`;
    const res = await fetch(url, { headers: withCookie(limitedCookie) });
    expect(res.status).toBe(403);
  });

  it("POST /api/api-tests/build succeeds for python API solutions", async () => {
    const project = await createProject({
      solutionName: "BuildTestPyOk",
      namespace: "BuildTestPyOk",
      language: "python",
      solutionType: "api",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/api-tests/build`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        solutionName: project.solutionName,
        baseUrl: "https://api.example.com",
        urlName: "Default",
        endpointName: "GetUsers",
        endpointPath: "/users",
        buildInto: "testMethod",
        testMethodName: "GetUsers_Returns200",
        testClass: { mode: "new", className: "UsersTests" },
        helperMethodName: "GetUsersAsync",
        parameters: [],
        httpMethod: "GET",
        useAccessToken: false,
        multipartFields: [],
        defaultHeaders: [],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: Array<{ path: string }> };
    const paths = body.files.map((f) => f.path).sort();
    expect(paths).toContain("automation_api/constants/api_endpoints.py");
    expect(paths).toContain(
      "tests/api_testing_assistants/users_tests_api_testing_assistants.py",
    );
    expect(paths).toContain("tests/tests/test_UsersTests.py");
    expect(paths).toContain("tests/appsettings.json");

    // Files actually exist on disk and contain expected content.
    const endpoints = await fs.readFile(
      path.join(project.rootPath, "automation_api/constants/api_endpoints.py"),
      "utf8",
    );
    expect(endpoints).toContain('GetUsers = "/users"');
    const appsettings = JSON.parse(
      await fs.readFile(
        path.join(project.rootPath, "tests/appsettings.json"),
        "utf8",
      ),
    );
    expect(appsettings.ApiTest.Urls.Default.BaseUrl).toBe(
      "https://api.example.com",
    );
  });

  it("POST /api/api-tests/build builds a Java API test end-to-end", async () => {
    const project = await createProject({
      solutionName: "BuildTestJava",
      namespace: "BuildTestJava",
      language: "java",
      solutionType: "api",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/api-tests/build`, {
      method: "POST",
      headers: withCookie(adminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        solutionName: project.solutionName,
        baseUrl: "https://api.example.com",
        urlName: "Default",
        endpointName: "GetUsers",
        endpointPath: "/users",
        buildInto: "testMethod",
        testMethodName: "GetUsers_Returns200",
        testClass: { mode: "new", className: "UsersTests" },
        helperMethodName: "getUsersAsync",
        parameters: [],
        httpMethod: "GET",
        useAccessToken: false,
        multipartFields: [],
        defaultHeaders: [],
      }),
    });
    expect(res.status).toBe(200);
    const root = path.dirname(project.slnPath);
    const helperRoot = path.join(
      root,
      "BuildTestJava-automation-api",
      "src",
      "main",
      "java",
      "com",
      "buildtestjava",
      "automation",
      "api",
    );
    const testsRoot = path.join(
      root,
      "BuildTestJava-automation-api-tests",
      "src",
      "test",
      "java",
      "com",
      "buildtestjava",
      "automation",
      "api",
      "tests",
    );
    const endpoints = await fs.readFile(
      path.join(helperRoot, "constants", "ApiEndpoints.java"),
      "utf8",
    );
    expect(endpoints).toContain('public static final String GetUsers = "/users";');
    const appsettings = JSON.parse(
      await fs.readFile(
        path.join(
          root,
          "BuildTestJava-automation-api-tests",
          "src",
          "test",
          "resources",
          "appsettings.json",
        ),
        "utf8",
      ),
    ) as { ApiTest: { Urls: Record<string, { BaseUrl: string }> } };
    expect(appsettings.ApiTest.Urls.Default.BaseUrl).toBe(
      "https://api.example.com",
    );
    const assistant = await fs.readFile(
      path.join(
        testsRoot,
        "apitestingassistants",
        "UsersTestsAPITestingAssistants.java",
      ),
      "utf8",
    );
    expect(assistant).toContain(
      "public java.net.http.HttpResponse<String> getUsersAsync(",
    );
    const testFile = await fs.readFile(
      path.join(testsRoot, "tests", "UsersTests.java"),
      "utf8",
    );
    expect(testFile).toContain("@Tag(TestCollections.API)");
    expect(testFile).toContain("void GetUsers_Returns200()");
    expect(testFile).toContain(
      "assertThat(response.statusCode()).isEqualTo(200);",
    );
  });

  it.each([] as Array<never>)(
    "POST /api/api-tests/build returns 501 for %s API solutions",
    async (lang) => {
      const project = await createProject({
        solutionName: `BuildTest${lang}`,
        namespace: `BuildTest${lang}`,
        language: lang,
        solutionType: "api",
      });
      setCurrentProject(project, adminUserId);
      const res = await fetch(`${baseUrl}/api/api-tests/build`, {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          solutionName: project.solutionName,
          baseUrl: "https://api.example.com",
          urlName: "Default",
          endpointName: "GetUsers",
          endpointPath: "/users",
          buildInto: "testMethod",
          testMethodName: "GetUsers_Returns200",
          testClass: { mode: "new", className: "UsersTests" },
          helperMethodName: "GetUsersAsync",
          parameters: [],
          httpMethod: "GET",
          useAccessToken: false,
          multipartFields: [],
          defaultHeaders: [],
        }),
      });
      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe(
        `API test build for ${lang} is not implemented yet`,
      );
    },
  );

  it("limited user can export an active fork they own", async () => {
    const project = await createProject({
      solutionName: "LimitedHasFork",
      namespace: "LimitedHasFork.QA",
    });
    const fork = await createFork({
      userId: limitedUserId,
      projectName: project.solutionName,
      decidedBy: adminUserId,
    });
    const forkSln = path.join(fork.forkPath, `${fork.projectName}.sln`);
    const url = `${baseUrl}/api/projects/zip?slnPath=${encodeURIComponent(forkSln)}`;
    const res = await fetch(url, { headers: withCookie(limitedCookie) });
    expect(res.status).toBe(200);
  });
});

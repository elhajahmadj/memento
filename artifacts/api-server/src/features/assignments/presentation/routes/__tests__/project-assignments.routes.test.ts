import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { eq } from "drizzle-orm";
import { db, projectAssignmentsTable } from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import { createAssignment } from "@/features/assignments/infrastructure/assignmentService";

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedAdminCookie: string;
let adminUserId = "";
let limitedAdminUserId = "";

const ADMIN_USERNAME = "vitest-paroutes-admin";
const LIMITED_ADMIN_USERNAME = "vitest-paroutes-ladmin";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  const ladmin = await provisionUser({
    username: LIMITED_ADMIN_USERNAME,
    role: "limited_admin",
  });
  limitedAdminUserId = ladmin.id;
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedAdminCookie = await login(baseUrl, LIMITED_ADMIN_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_ADMIN_USERNAME);
  await close();
});

afterEach(async () => {
  await db
    .delete(projectAssignmentsTable)
    .where(eq(projectAssignmentsTable.userId, limitedAdminUserId));
});

describe("createAssignment role acceptance (regression for limited-user approval flow)", () => {
  const LIMITED_USERNAME = "vitest-paroutes-limited";
  let limitedUserId = "";
  beforeAll(async () => {
    const u = await provisionUser({
      username: LIMITED_USERNAME,
      role: "limited",
    });
    limitedUserId = u.id;
  });
  afterAll(async () => {
    await deleteUserByUsername(LIMITED_USERNAME);
  });
  afterEach(async () => {
    await db
      .delete(projectAssignmentsTable)
      .where(eq(projectAssignmentsTable.userId, limitedUserId));
  });

  it("accepts a `limited` (User-role) assignee — required so approved project requests can grant access", async () => {
    const row = await createAssignment({
      userId: limitedUserId,
      projectName: "PA-LimitedAccept",
      assignedBy: adminUserId,
    });
    expect(row.userId).toBe(limitedUserId);
    expect(row.projectName).toBe("PA-LimitedAccept");
  });

  it("still rejects non-limited roles (admin/memento_admin)", async () => {
    await expect(
      createAssignment({
        userId: adminUserId,
        projectName: "PA-AdminReject",
        assignedBy: adminUserId,
      }),
    ).rejects.toThrow(/limited_admin or limited/);
  });
});

describe("GET /api/project-assignments", () => {
  it("returns the list to an admin", async () => {
    await createAssignment({
      userId: limitedAdminUserId,
      projectName: "PA-List",
      assignedBy: adminUserId,
    });
    const res = await fetch(`${baseUrl}/api/project-assignments`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ projectName: string }>;
    expect(body.find((r) => r.projectName === "PA-List")).toBeDefined();
  });

  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(`${baseUrl}/api/project-assignments`, {
      headers: withCookie(limitedAdminCookie),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/project-assignments", () => {
  it("creates an assignment (admin)", async () => {
    const res = await fetch(`${baseUrl}/api/project-assignments`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        userId: limitedAdminUserId,
        projectName: "PA-Create",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { projectName: string };
    expect(body.projectName).toBe("PA-Create");
  });

  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(`${baseUrl}/api/project-assignments`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        userId: limitedAdminUserId,
        projectName: "PA-CreateX",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await fetch(`${baseUrl}/api/project-assignments`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/project-assignments/:userId/:projectName", () => {
  it("removes an existing assignment (admin)", async () => {
    await createAssignment({
      userId: limitedAdminUserId,
      projectName: "PA-Del",
      assignedBy: adminUserId,
    });
    const res = await fetch(
      `${baseUrl}/api/project-assignments/${limitedAdminUserId}/PA-Del`,
      { method: "DELETE", headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(204);
  });

  it("returns 404 when the assignment does not exist", async () => {
    const res = await fetch(
      `${baseUrl}/api/project-assignments/${limitedAdminUserId}/PA-Missing`,
      { method: "DELETE", headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(
      `${baseUrl}/api/project-assignments/${limitedAdminUserId}/PA-X`,
      { method: "DELETE", headers: withCookie(limitedAdminCookie) },
    );
    expect(res.status).toBe(403);
  });
});

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  projectAccessRequestsTable,
  projectAssignmentsTable,
} from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import { createAccessRequest } from "@/features/access-requests/infrastructure/accessRequestService";

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedAdminCookie: string;
let limitedCookie: string;
let limitedAdminUserId = "";

const ADMIN_USERNAME = "vitest-arroutes-admin";
const LIMITED_ADMIN_USERNAME = "vitest-arroutes-ladmin";
const LIMITED_USERNAME = "vitest-arroutes-limited";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  const ladmin = await provisionUser({
    username: LIMITED_ADMIN_USERNAME,
    role: "limited_admin",
  });
  limitedAdminUserId = ladmin.id;
  await provisionUser({ username: LIMITED_USERNAME, role: "limited" });
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedAdminCookie = await login(baseUrl, LIMITED_ADMIN_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await close();
});

afterEach(async () => {
  // Wipe just the rows owned by our test limited_admin user. Also clear any
  // assignment rows that the approve happy-path test created so the table
  // doesn't accumulate cross-suite garbage.
  await db
    .delete(projectAccessRequestsTable)
    .where(eq(projectAccessRequestsTable.userId, limitedAdminUserId));
  await db
    .delete(projectAssignmentsTable)
    .where(eq(projectAssignmentsTable.userId, limitedAdminUserId));
});

describe("POST /api/project-access-requests", () => {
  it("creates a request for a limited_admin caller", async () => {
    const res = await fetch(`${baseUrl}/api/project-access-requests`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ projectName: "AR-Proj-A" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; projectName: string };
    expect(body.status).toBe("pending");
    expect(body.projectName).toBe("AR-Proj-A");
  });

  it("rejects a plain limited user with 403", async () => {
    const res = await fetch(`${baseUrl}/api/project-access-requests`, {
      method: "POST",
      headers: withCookie(limitedCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ projectName: "AR-Proj-B" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await fetch(`${baseUrl}/api/project-access-requests`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/project-access-requests", () => {
  it("returns a list to admin", async () => {
    await createAccessRequest({
      userId: limitedAdminUserId,
      projectName: "AR-List",
    });
    const res = await fetch(`${baseUrl}/api/project-access-requests`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ projectName: string }>;
    expect(body.find((r) => r.projectName === "AR-List")).toBeDefined();
  });

  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(`${baseUrl}/api/project-access-requests`, {
      headers: withCookie(limitedAdminCookie),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid status filter with 400", async () => {
    const res = await fetch(
      `${baseUrl}/api/project-access-requests?status=junk`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/project-access-requests/mine", () => {
  it("returns only the caller's own requests", async () => {
    await createAccessRequest({
      userId: limitedAdminUserId,
      projectName: "AR-Mine",
    });
    const res = await fetch(`${baseUrl}/api/project-access-requests/mine`, {
      headers: withCookie(limitedAdminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ projectName: string }>;
    expect(body.find((r) => r.projectName === "AR-Mine")).toBeDefined();
  });
});

describe("POST /api/project-access-requests/:id/approve and /deny", () => {
  it("approves a pending request and creates the assignment (admin)", async () => {
    const created = await createAccessRequest({
      userId: limitedAdminUserId,
      projectName: "AR-Approve",
    });
    const res = await fetch(
      `${baseUrl}/api/project-access-requests/${created.id}/approve`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ note: "go for it" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      projectName: string;
      note: string | null;
    };
    expect(body.status).toBe("approved");
    expect(body.projectName).toBe("AR-Approve");
    expect(body.note).toBe("go for it");
    // Side effect: an assignment row was inserted for the requesting user.
    const assigns = await db
      .select()
      .from(projectAssignmentsTable)
      .where(eq(projectAssignmentsTable.userId, limitedAdminUserId));
    expect(assigns.find((a) => a.projectName === "AR-Approve")).toBeDefined();
  });

  it("denies a pending request (admin)", async () => {
    const created = await createAccessRequest({
      userId: limitedAdminUserId,
      projectName: "AR-Deny",
    });
    const res = await fetch(
      `${baseUrl}/api/project-access-requests/${created.id}/deny`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ note: "later" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("denied");
  });

  it("rejects a non-admin caller with 403 on approve", async () => {
    const created = await createAccessRequest({
      userId: limitedAdminUserId,
      projectName: "AR-Deny2",
    });
    const res = await fetch(
      `${baseUrl}/api/project-access-requests/${created.id}/approve`,
      {
        method: "POST",
        headers: withCookie(limitedAdminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 on an invalid uuid", async () => {
    const res = await fetch(
      `${baseUrl}/api/project-access-requests/not-uuid/approve`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/project-access-requests/:id", () => {
  it("returns the row to admin", async () => {
    const created = await createAccessRequest({
      userId: limitedAdminUserId,
      projectName: "AR-Get",
    });
    const res = await fetch(
      `${baseUrl}/api/project-access-requests/${created.id}`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(created.id);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await fetch(
      `${baseUrl}/api/project-access-requests/00000000-0000-0000-0000-000000000000`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });
});


/**
 * REST coverage for /api/shared-steps:
 *  - GET / POST / DELETE happy-path (admin)
 *  - per-(user, project) scoping: a second user on the same project
 *    must not see / overwrite / delete the first user's library.
 *  - role gate: an unassigned limited_admin gets 403 from
 *    requireAdminOrAssignedToCurrentProjectOrOwner.
 *  - 401 with no session.
 *  - 400 when no project is loaded.
 *  - upsert semantics: re-POSTing the same name overwrites in place.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { and, eq } from "drizzle-orm";
import { db, sharedStepsTable } from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import {
  setCurrentProject,
  type Project,
} from "@/features/projects/infrastructure/projectService";

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let otherAdminCookie: string;
let limitedCookie: string;
let adminUserId = "";
let otherAdminUserId = "";
let limitedUserId = "";

const ADMIN_USERNAME = "vitest-shared-admin";
const OTHER_USERNAME = "vitest-shared-other";
const LIMITED_USERNAME = "vitest-shared-limited";
const PROJECT_NAME = "SharedStepsProj";

function fakeProject(name = PROJECT_NAME): Project {
  return {
    solutionName: name,
    testProjectName: `${name}.Tests`,
    namespace: name,
    rootPath: "/tmp/does-not-matter",
    slnPath: "/tmp/does-not-matter/x.sln",
    language: "csharp",
  };
}

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  adminUserId = (
    await provisionUser({ username: ADMIN_USERNAME, role: "admin" })
  ).id;
  otherAdminUserId = (
    await provisionUser({ username: OTHER_USERNAME, role: "admin" })
  ).id;
  limitedUserId = (
    await provisionUser({ username: LIMITED_USERNAME, role: "limited_admin" })
  ).id;
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  otherAdminCookie = await login(baseUrl, OTHER_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(OTHER_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await close();
});

beforeEach(async () => {
  // Each test fresh-loads the shared project for both admins so the
  // /api/shared-steps routes find one in `getCurrentProject`.
  setCurrentProject(fakeProject(), adminUserId);
  setCurrentProject(fakeProject(), otherAdminUserId);
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  setCurrentProject(null, otherAdminUserId);
  setCurrentProject(null, limitedUserId);
  // Clean DB rows to keep tests order-independent.
  await db
    .delete(sharedStepsTable)
    .where(eq(sharedStepsTable.projectName, PROJECT_NAME));
});

describe("GET /api/shared-steps", () => {
  it("returns an empty list for a fresh project", async () => {
    const res = await fetch(`${baseUrl}/api/shared-steps`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it("401 without a session", async () => {
    const res = await fetch(`${baseUrl}/api/shared-steps`);
    expect(res.status).toBe(401);
  });

  it("404 when no project is loaded", async () => {
    // The project guard middleware
    // (`requireAdminOrAssignedToCurrentProjectOrOwner`) short-circuits
    // with 404 when the caller has no project loaded — this fires
    // before the route handler's local "No project loaded" 400, which
    // is now defensive dead code. 404 is the canonical contract used
    // across every project-scoped route in the API.
    setCurrentProject(null, adminUserId);
    const res = await fetch(`${baseUrl}/api/shared-steps`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/shared-steps", () => {
  it("creates a shared step then returns it from GET", async () => {
    const body = {
      name: "LoginAsAdmin",
      description: "Click login + fill creds",
      actions: [
        { type: "click", selector: "[data-testid=login]" },
        { type: "fill", selector: "[name=username]", value: "admin" },
      ],
    };
    const post = await fetch(`${baseUrl}/api/shared-steps`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    expect(post.status).toBe(200);
    const created = (await post.json()) as {
      item: { name: string; description: string; actions: unknown[] };
    };
    expect(created.item.name).toBe("LoginAsAdmin");
    expect(created.item.actions).toHaveLength(2);

    const get = await fetch(`${baseUrl}/api/shared-steps`, {
      headers: withCookie(adminCookie),
    });
    const list = (await get.json()) as { items: { name: string }[] };
    expect(list.items.map((i) => i.name)).toContain("LoginAsAdmin");
  });

  it("re-POSTing the same name upserts in place (no duplicate row)", async () => {
    const post1 = await fetch(`${baseUrl}/api/shared-steps`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        name: "SharedDup",
        description: "first",
        actions: [{ type: "click", selector: "#a" }],
      }),
    });
    expect(post1.status).toBe(200);
    const post2 = await fetch(`${baseUrl}/api/shared-steps`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        name: "SharedDup",
        description: "second",
        actions: [
          { type: "click", selector: "#a" },
          { type: "click", selector: "#b" },
        ],
      }),
    });
    expect(post2.status).toBe(200);
    const updated = (await post2.json()) as {
      item: { description: string; actions: unknown[] };
    };
    expect(updated.item.description).toBe("second");
    expect(updated.item.actions).toHaveLength(2);

    // Only one row in the DB for this (user, project, name) — the
    // unique index guarantees this and onConflictDoUpdate is honored.
    const rows = await db
      .select()
      .from(sharedStepsTable)
      .where(
        and(
          eq(sharedStepsTable.userId, adminUserId),
          eq(sharedStepsTable.projectName, PROJECT_NAME),
          eq(sharedStepsTable.name, "SharedDup"),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("400 on invalid name (Zod regex)", async () => {
    const res = await fetch(`${baseUrl}/api/shared-steps`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        name: "1bad/name",
        actions: [{ type: "click", selector: "#a" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("400 on empty actions array", async () => {
    const res = await fetch(`${baseUrl}/api/shared-steps`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ name: "Empty", actions: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/shared-steps/:name", () => {
  it("removes the row and 404s on a second delete", async () => {
    await fetch(`${baseUrl}/api/shared-steps`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        name: "ToDelete",
        actions: [{ type: "click", selector: "#a" }],
      }),
    });
    const res1 = await fetch(
      `${baseUrl}/api/shared-steps/ToDelete`,
      { method: "DELETE", headers: withCookie(adminCookie) },
    );
    expect(res1.status).toBe(200);
    const res2 = await fetch(
      `${baseUrl}/api/shared-steps/ToDelete`,
      { method: "DELETE", headers: withCookie(adminCookie) },
    );
    expect(res2.status).toBe(404);
  });
});

describe("per-(user, project) scoping", () => {
  it("a second admin on the same project sees their own (empty) library", async () => {
    await fetch(`${baseUrl}/api/shared-steps`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        name: "OnlyMine",
        actions: [{ type: "click", selector: "#a" }],
      }),
    });
    // The second admin loads the same project but should NOT see the
    // first admin's macro — fork-style isolation per (user, project).
    const res = await fetch(`${baseUrl}/api/shared-steps`, {
      headers: withCookie(otherAdminCookie),
    });
    const body = (await res.json()) as { items: { name: string }[] };
    expect(body.items.map((i) => i.name)).not.toContain("OnlyMine");
  });

  it("a second admin DELETE on the first admin's name 404s (no cross-user reach)", async () => {
    await fetch(`${baseUrl}/api/shared-steps`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        name: "OnlyMineToo",
        actions: [{ type: "click", selector: "#a" }],
      }),
    });
    const res = await fetch(
      `${baseUrl}/api/shared-steps/OnlyMineToo`,
      { method: "DELETE", headers: withCookie(otherAdminCookie) },
    );
    expect(res.status).toBe(404);
  });
});

describe("role gate (requireAdminOrAssignedToCurrentProjectOrOwner)", () => {
  it("403s an unassigned limited_admin user", async () => {
    setCurrentProject(fakeProject(), limitedUserId);
    const res = await fetch(`${baseUrl}/api/shared-steps`, {
      headers: withCookie(limitedCookie),
    });
    expect(res.status).toBe(403);
  });
});

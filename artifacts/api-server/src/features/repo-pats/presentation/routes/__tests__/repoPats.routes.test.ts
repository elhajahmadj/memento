import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { like, eq, inArray, or } from "drizzle-orm";
import {
  db,
  repoPatsTable,
  projectGitConfigsTable,
  usersTable,
} from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";

process.env.PROJECT_SECRETS_KEY ??=
  "vitest-repo-pats-routes-secret-xxxxxxx";

const PREFIX = "vitest-repopat-routes-";
const ADMIN = `${PREFIX}admin`;
const NON_ADMIN = `${PREFIX}user`;

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let userCookie: string;
let adminId = "";

async function scrub(): Promise<void> {
  // Find any prefix-owned user ids from a previous run first so we can
  // wipe everything that references them through ON DELETE RESTRICT
  // foreign keys before deleting the users themselves. Without this,
  // residue in `project_git_configs.updated_by_user_id` or
  // `repo_pats.created_by_user_id` / `updated_by_user_id` from a
  // crashed prior run blocks the user delete and the suite never
  // gets a clean fixture (login then fails 401 because no admin row
  // exists with the freshly-hashed password).
  const residualUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(like(usersTable.username, `${PREFIX}%`));
  const residualUserIds = residualUsers.map((u) => u.id);

  await db
    .delete(projectGitConfigsTable)
    .where(
      residualUserIds.length > 0
        ? or(
            like(projectGitConfigsTable.projectName, `${PREFIX}%`),
            inArray(projectGitConfigsTable.updatedByUserId, residualUserIds),
          )
        : like(projectGitConfigsTable.projectName, `${PREFIX}%`),
    );
  await db
    .delete(repoPatsTable)
    .where(
      residualUserIds.length > 0
        ? or(
            like(repoPatsTable.name, `${PREFIX}%`),
            inArray(repoPatsTable.createdByUserId, residualUserIds),
            inArray(repoPatsTable.updatedByUserId, residualUserIds),
          )
        : like(repoPatsTable.name, `${PREFIX}%`),
    );
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
}

beforeAll(async () => {
  await scrub();
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({ username: ADMIN, role: "admin" });
  adminId = admin.id;
  await provisionUser({ username: NON_ADMIN, role: "limited" });
  adminCookie = await login(baseUrl, ADMIN);
  userCookie = await login(baseUrl, NON_ADMIN);
});

afterAll(async () => {
  await scrub();
  await deleteUserByUsername(ADMIN);
  await deleteUserByUsername(NON_ADMIN);
  await close();
}, 30_000);

beforeEach(async () => {
  await db
    .delete(projectGitConfigsTable)
    .where(like(projectGitConfigsTable.projectName, `${PREFIX}%`));
  await db.delete(repoPatsTable).where(like(repoPatsTable.name, `${PREFIX}%`));
});

interface PublicPat {
  id: string;
  provider: string;
  name: string;
  patLastFour: string;
  createdAt: string;
  updatedAt: string;
}

async function createViaApi(name: string, pat = "abcdefghij1234XYZ") {
  const res = await fetch(`${baseUrl}/api/repo-pats`, {
    method: "POST",
    headers: withCookie(adminCookie, { "content-type": "application/json" }),
    body: JSON.stringify({ provider: "azure_repos", name, pat }),
  });
  if (res.status !== 201) {
    throw new Error(`createViaApi(${name}) failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as PublicPat;
}

describe("GET /api/repo-pats", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${baseUrl}/api/repo-pats`);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin callers", async () => {
    const res = await fetch(`${baseUrl}/api/repo-pats`, {
      headers: withCookie(userCookie),
    });
    expect(res.status).toBe(403);
  });

  it("returns only public fields for admins", async () => {
    const created = await createViaApi(`${PREFIX}list-1`, "abcdefghLAST");
    const res = await fetch(`${baseUrl}/api/repo-pats`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const all = (await res.json()) as PublicPat[];
    const row = all.find((r) => r.id === created.id)!;
    expect(row).toBeTruthy();
    expect(row.patLastFour).toBe("LAST");
    expect(JSON.stringify(all)).not.toContain("patEncrypted");
    expect(JSON.stringify(all)).not.toContain("abcdefghLAST");
  });
});

describe("POST /api/repo-pats", () => {
  it("creates a row and returns 201 with the public shape", async () => {
    const res = await fetch(`${baseUrl}/api/repo-pats`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "github",
        name: `${PREFIX}created`,
        pat: "ghpfgh_aaaa1234",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as PublicPat;
    expect(body.provider).toBe("github");
    expect(body.patLastFour).toBe("1234");
  });

  it("returns 400 on missing fields", async () => {
    const res = await fetch(`${baseUrl}/api/repo-pats`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ provider: "github", name: `${PREFIX}x` }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 on duplicate (provider, name)", async () => {
    await createViaApi(`${PREFIX}dup`);
    const res = await fetch(`${baseUrl}/api/repo-pats`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        name: `${PREFIX}dup`,
        pat: "abcdefghij",
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /already exists/,
    );
  });

  it("rejects non-admin callers", async () => {
    const res = await fetch(`${baseUrl}/api/repo-pats`, {
      method: "POST",
      headers: withCookie(userCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "github",
        name: `${PREFIX}forbidden`,
        pat: "abcdefghij",
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/repo-pats/:id", () => {
  it("renames without rotating the PAT when body.pat is omitted", async () => {
    const created = await createViaApi(`${PREFIX}rename`, "originalXXLAST");
    const res = await fetch(`${baseUrl}/api/repo-pats/${created.id}`, {
      method: "PATCH",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        name: `${PREFIX}renamed`,
        // pat omitted → keep existing
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicPat;
    expect(body.name).toBe(`${PREFIX}renamed`);
    expect(body.patLastFour).toBe("LAST");
  });

  it("rotates the PAT when a new value is sent", async () => {
    const created = await createViaApi(`${PREFIX}rotate`, "originalAAAA");
    const res = await fetch(`${baseUrl}/api/repo-pats/${created.id}`, {
      method: "PATCH",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        name: `${PREFIX}rotate`,
        pat: "rotated9999ZZZZ",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicPat;
    expect(body.patLastFour).toBe("ZZZZ");
  });

  it("returns 404 for an unknown id", async () => {
    const res = await fetch(
      `${baseUrl}/api/repo-pats/00000000-0000-0000-0000-000000000000`,
      {
        method: "PATCH",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          provider: "azure_repos",
          name: `${PREFIX}ghost`,
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("rejects non-admin callers", async () => {
    const created = await createViaApi(`${PREFIX}patch-forbid`);
    const res = await fetch(`${baseUrl}/api/repo-pats/${created.id}`, {
      method: "PATCH",
      headers: withCookie(userCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        name: `${PREFIX}patch-forbid`,
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/repo-pats/:id", () => {
  it("deletes an unbound PAT and returns 204", async () => {
    const created = await createViaApi(`${PREFIX}del-ok`);
    const res = await fetch(`${baseUrl}/api/repo-pats/${created.id}`, {
      method: "DELETE",
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(204);
    const rows = await db
      .select()
      .from(repoPatsTable)
      .where(eq(repoPatsTable.id, created.id));
    expect(rows).toHaveLength(0);
  });

  it("returns 409 with boundProjects when the PAT is in use", async () => {
    const created = await createViaApi(`${PREFIX}del-bound`);
    await db.insert(projectGitConfigsTable).values({
      projectName: `${PREFIX}proj-bound`,
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/o/p/_git/r",
      branch: "main",
      patEncrypted: null,
      patLastFour: null,
      patSetAt: null,
      repoPatId: created.id,
      updatedByUserId: adminId,
    });
    const res = await fetch(`${baseUrl}/api/repo-pats/${created.id}`, {
      method: "DELETE",
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      boundProjects: string[];
    };
    expect(body.boundProjects).toEqual([`${PREFIX}proj-bound`]);
    // Row must still exist.
    const rows = await db
      .select()
      .from(repoPatsTable)
      .where(eq(repoPatsTable.id, created.id));
    expect(rows).toHaveLength(1);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await fetch(
      `${baseUrl}/api/repo-pats/00000000-0000-0000-0000-000000000000`,
      { method: "DELETE", headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("rejects non-admin callers", async () => {
    const created = await createViaApi(`${PREFIX}del-forbid`);
    const res = await fetch(`${baseUrl}/api/repo-pats/${created.id}`, {
      method: "DELETE",
      headers: withCookie(userCookie),
    });
    expect(res.status).toBe(403);
  });
});

/**
 * Route-level tests for the per-user "my fork" endpoints
 * (task #58 coverage). Drives the real Express app over HTTP,
 * exercising:
 *   - GET happy path + empty/null payload before configuration.
 *   - PUT create + update happy paths; PAT redaction in the response
 *     body (never leaks the plaintext or the encrypted blob).
 *   - PUT validation (bad provider, short PAT, missing PAT on first
 *     save, wrong-host URL, bad URL).
 *   - DELETE clears the row and a subsequent GET reports unconfigured.
 *   - Cross-user isolation: user B reading / writing / deleting
 *     `/projects/X/my-fork` only ever touches user B's own row.
 *   - 401 when unauthenticated.
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
import { like } from "drizzle-orm";
import { db, userProjectForksTable, usersTable } from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";

process.env.PROJECT_SECRETS_KEY ??=
  "vitest-myfork-routes-secret-xxxxxxxxxxxxxxxx";

const PREFIX = "vitest-myfork-";
const USER_A = `${PREFIX}alice`;
const USER_B = `${PREFIX}bob`;
const PROJECT = `${PREFIX}Project`;

let baseUrl: string;
let close: () => Promise<void>;
let cookieA: string;
let cookieB: string;

async function scrubForks(): Promise<void> {
  await db
    .delete(userProjectForksTable)
    .where(like(userProjectForksTable.projectName, `${PREFIX}%`));
}

beforeAll(async () => {
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
  ({ baseUrl, close } = await bootServer());
  await provisionUser({ username: USER_A, role: "limited" });
  await provisionUser({ username: USER_B, role: "limited" });
  cookieA = await login(baseUrl, USER_A);
  cookieB = await login(baseUrl, USER_B);
});

afterAll(async () => {
  await scrubForks();
  await deleteUserByUsername(USER_A);
  await deleteUserByUsername(USER_B);
  await close();
}, 30_000);

beforeEach(scrubForks);
afterEach(scrubForks);

describe("GET /api/projects/:projectName/my-fork", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`);
    expect(res.status).toBe(401);
  });

  it("returns an empty/null payload before any fork is configured", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      headers: withCookie(cookieA),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      configured: boolean;
      provider: string | null;
      repoUrl: string | null;
      patSetAt: string | null;
      patLastFour: string | null;
    };
    expect(body).toMatchObject({
      configured: false,
      provider: null,
      repoUrl: null,
      patSetAt: null,
      patLastFour: null,
    });
  });
});

describe("PUT /api/projects/:projectName/my-fork", () => {
  it("creates the fork, returns only the last four of the PAT, and never leaks plaintext", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/me/myproj/_git/myfork",
        pat: "personal-pat-1234-WXYZ",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      configured: boolean;
      provider: string;
      repoUrl: string;
      patSetAt: string;
      patLastFour: string;
    };
    expect(body.configured).toBe(true);
    expect(body.provider).toBe("azure_repos");
    expect(body.repoUrl).toBe(
      "https://dev.azure.com/me/myproj/_git/myfork",
    );
    expect(body.patLastFour).toBe("WXYZ");
    const text = JSON.stringify(body);
    expect(text).not.toContain("personal-pat-1234-WXYZ");
    expect(text).not.toContain("patEncrypted");
  });

  it("accepts a github provider URL", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "github",
        repoUrl: "https://github.com/me/myfork.git",
        pat: "ghp-abcdefghij",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string; repoUrl: string };
    expect(body.provider).toBe("github");
    expect(body.repoUrl).toBe("https://github.com/me/myfork.git");
  });

  it("rejects pat: null on the very first save", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/o/p/_git/r",
        pat: null,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a wrong-host repo URL for the chosen provider", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        repoUrl: "https://example.com/o/p/_git/r",
        pat: "personal-pat-1234",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a too-short PAT", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/o/p/_git/r",
        pat: "short",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("supports updating URL/provider with pat: null (keeps existing PAT)", async () => {
    // Initial create.
    const create = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/o/p/_git/v1",
        pat: "original-pat-aaaa",
      }),
    });
    expect(create.status).toBe(200);
    const initial = (await create.json()) as {
      patSetAt: string;
      patLastFour: string;
    };

    await new Promise((r) => setTimeout(r, 5));

    const update = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "github",
        repoUrl: "https://github.com/me/myfork.git",
        pat: null,
      }),
    });
    expect(update.status).toBe(200);
    const after = (await update.json()) as {
      provider: string;
      repoUrl: string;
      patSetAt: string;
      patLastFour: string;
    };
    expect(after.provider).toBe("github");
    expect(after.repoUrl).toBe("https://github.com/me/myfork.git");
    expect(after.patLastFour).toBe("aaaa");
    expect(after.patSetAt).toBe(initial.patSetAt);
  });

  it.each([
    ["unknown string", "bitbucket"],
    ["empty string", ""],
    ["wrong type (number)", 42],
    ["null", null],
  ])(
    "rejects bad provider value (%s) with HTTP 400 and never writes a row",
    async (_label, providerValue) => {
      const res = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
        method: "PUT",
        headers: withCookie(cookieA, { "content-type": "application/json" }),
        body: JSON.stringify({
          provider: providerValue,
          repoUrl: "https://dev.azure.com/o/p/_git/v1",
          pat: "any-pat-1234",
        }),
      });
      expect(res.status).toBe(400);
      // And a follow-up GET must still report unconfigured — the bad
      // payload must not have created or mutated a row.
      const after = await fetch(
        `${baseUrl}/api/projects/${PROJECT}/my-fork`,
        { headers: withCookie(cookieA) },
      );
      const body = (await after.json()) as { configured: boolean };
      expect(body.configured).toBe(false);
    },
  );

  it("rotates the PAT when a new one is supplied on a subsequent PUT", async () => {
    await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/o/p/_git/v1",
        pat: "first-pat-0001",
      }),
    });
    const res = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/o/p/_git/v1",
        pat: "rotated-pat-ZZZZ",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { patLastFour: string };
    expect(body.patLastFour).toBe("ZZZZ");
  });
});

describe("DELETE /api/projects/:projectName/my-fork", () => {
  it("clears the row and a subsequent GET reports unconfigured (204 idempotent)", async () => {
    // Seed.
    await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/o/p/_git/v1",
        pat: "personal-pat-1234",
      }),
    });
    const del = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "DELETE",
      headers: withCookie(cookieA),
    });
    expect(del.status).toBe(204);
    const after = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      headers: withCookie(cookieA),
    });
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as { configured: boolean };
    expect(afterBody.configured).toBe(false);

    // Idempotent: a second DELETE on an empty row still returns 204.
    const del2 = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "DELETE",
      headers: withCookie(cookieA),
    });
    expect(del2.status).toBe(204);
  });
});

describe("Cross-user isolation on /my-fork", () => {
  beforeEach(async () => {
    await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/alice/p/_git/r",
        pat: "alice-pat-aaaa",
      }),
    });
  });

  it("user B's GET on the same project name returns unconfigured (cannot read A's row)", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      headers: withCookie(cookieB),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      configured: boolean;
      repoUrl: string | null;
      patLastFour: string | null;
    };
    expect(body.configured).toBe(false);
    expect(body.repoUrl).toBeNull();
    expect(body.patLastFour).toBeNull();
  });

  it("user B's PUT creates a separate row and does not overwrite A's fork", async () => {
    const put = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "PUT",
      headers: withCookie(cookieB, { "content-type": "application/json" }),
      body: JSON.stringify({
        provider: "github",
        repoUrl: "https://github.com/bob/r.git",
        pat: "bob-pat-bbbb",
      }),
    });
    expect(put.status).toBe(200);
    const aRes = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      headers: withCookie(cookieA),
    });
    const aBody = (await aRes.json()) as {
      provider: string;
      repoUrl: string;
      patLastFour: string;
    };
    expect(aBody.provider).toBe("azure_repos");
    expect(aBody.repoUrl).toBe("https://dev.azure.com/alice/p/_git/r");
    expect(aBody.patLastFour).toBe("aaaa");
  });

  it("user B's DELETE does not touch user A's row", async () => {
    // B deletes on the same project name — should be a no-op for B (no row)
    // and must leave A's row intact.
    const del = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      method: "DELETE",
      headers: withCookie(cookieB),
    });
    expect(del.status).toBe(204);
    const aRes = await fetch(`${baseUrl}/api/projects/${PROJECT}/my-fork`, {
      headers: withCookie(cookieA),
    });
    const aBody = (await aRes.json()) as { configured: boolean };
    expect(aBody.configured).toBe(true);
  });
});

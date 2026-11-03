import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { like } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { createProject } from "@/features/projects/infrastructure/projectService";

/**
 * End-to-end route coverage for the guest project flow.
 *
 * These exist because unit-testing the scope resolver was NOT enough:
 * `scopedProjectNames` / `filterVisibleProjectNames` were correct while
 * three *call sites* still branched on `policy.kind === "org"` with an
 * implicit else, so a guest's freshly-created project was invisible to
 * `/projects/available` and `/projects/current`, and `/projects/load`
 * tried to resolve a fork the guest doesn't have. The user-visible
 * symptom was "it said it was created, but I can't see it, and it
 * didn't take me to the workstation" — the workstation redirects back
 * to /projects when `/projects/current` reports null.
 *
 * Every assertion below is on the wiring, not the helpers.
 */

const GUEST_PREFIX = "guest-";
const OTHER_PROJECT = "VitestGuestFlowOtherProject";
const GUEST_PROJECT = "VitestGuestFlowMine";
const ADMIN_USERNAME = "vitest-guestflow-admin";

let baseUrl: string;
let close: () => Promise<void>;

async function rmProject(name: string): Promise<void> {
  await fs
    .rm(path.join(recorderConfig.workspaceDir, name), {
      recursive: true,
      force: true,
    })
    .catch(() => undefined);
}

/** Start a guest session and return its cookie. */
async function startGuest(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  expect(res.status, await res.clone().text()).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("guest sign-in returned no cookie");
  return setCookie.split(";")[0]!;
}

async function createAsGuest(
  cookie: string,
  solutionName: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: withCookie(cookie, { "content-type": "application/json" }),
    body: JSON.stringify({
      solutionName,
      testProjectName: `${solutionName}.Tests`,
      namespace: solutionName,
      language: "csharp",
    }),
  });
}

beforeAll(async () => {
  const booted = await bootServer();
  baseUrl = booted.baseUrl;
  close = booted.close;
});

afterAll(async () => {
  await close();
  await rmProject(OTHER_PROJECT);
  await deleteUserByUsername(ADMIN_USERNAME);
});

afterEach(async () => {
  // Deleting the guest user cascades its guest_sessions row.
  await db.delete(usersTable).where(like(usersTable.username, `${GUEST_PREFIX}%`));
  await rmProject(GUEST_PROJECT);
  await rmProject(`${GUEST_PROJECT}2`);
});

describe("guest project flow", () => {
  it("sees an empty list before creating anything", async () => {
    const cookie = await startGuest();
    const res = await fetch(`${baseUrl}/api/projects/available`, {
      headers: withCookie(cookie),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("sees its own project in /projects/available right after creating it", async () => {
    const cookie = await startGuest();
    const created = await createAsGuest(cookie, GUEST_PROJECT);
    expect(created.status, await created.clone().text()).toBe(201);

    const res = await fetch(`${baseUrl}/api/projects/available`, {
      headers: withCookie(cookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ solutionName: string }>;
    // The regression: this returned [] because guests fell through to
    // the limited-user tail, which short-circuits on "no assignments".
    expect(body.map((p) => p.solutionName)).toEqual([GUEST_PROJECT]);
  });

  it("reports the new project as current so the workstation can open it", async () => {
    const cookie = await startGuest();
    expect((await createAsGuest(cookie, GUEST_PROJECT)).status).toBe(201);

    const res = await fetch(`${baseUrl}/api/projects/current`, {
      headers: withCookie(cookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      project: { solutionName: string } | null;
    };
    // The regression: `/projects/current` hardcoded `false` for any
    // non-"org" bounded policy, so this was null and the workstation
    // bounced straight back to /projects.
    expect(body.project).not.toBeNull();
    expect(body.project?.solutionName).toBe(GUEST_PROJECT);
  });

  it("can load its own project without owning a fork", async () => {
    const cookie = await startGuest();
    const created = await createAsGuest(cookie, GUEST_PROJECT);
    const project = (await created.json()) as { slnPath: string };

    const res = await fetch(`${baseUrl}/api/projects/load`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({ slnPath: project.slnPath }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("refuses a second project with GUEST_PROJECT_LIMIT", async () => {
    const cookie = await startGuest();
    expect((await createAsGuest(cookie, GUEST_PROJECT)).status).toBe(201);

    const second = await createAsGuest(cookie, `${GUEST_PROJECT}2`);
    expect(second.status).toBe(409);
    const body = (await second.json()) as { code: string };
    expect(body.code).toBe("GUEST_PROJECT_LIMIT");
  });

  it("refuses a name taken by a project it cannot see, and suggests a free one", async () => {
    // A project the guest has no visibility into — the exact situation
    // that made a bare "already exists" read as a bug.
    await createProject({
      solutionName: OTHER_PROJECT,
      namespace: OTHER_PROJECT,
      language: "csharp",
    });
    const cookie = await startGuest();
    const res = await createAsGuest(cookie, OTHER_PROJECT);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; suggestion: string };
    expect(body.code).toBe("PROJECT_NAME_TAKEN");
    expect(body.suggestion).toBe(`${OTHER_PROJECT}2`);
  });

  it("does not burn the guest's one slot on a rejected name", async () => {
    await createProject({
      solutionName: OTHER_PROJECT,
      namespace: OTHER_PROJECT,
      language: "csharp",
    });
    const cookie = await startGuest();
    expect((await createAsGuest(cookie, OTHER_PROJECT)).status).toBe(409);
    // The slot must still be free — a failed name check must not
    // consume the one project a guest is allowed.
    const retry = await createAsGuest(cookie, GUEST_PROJECT);
    expect(retry.status, await retry.clone().text()).toBe(201);
  });

  it("can load the dashboard it lands on", async () => {
    // Regression: `DashboardSummary.role` omitted `guest`, so
    // `assertResponseShape` rejected the payload and every guest got a
    // 500 on the page they are redirected to right after signing in.
    const cookie = await startGuest();
    const res = await fetch(`${baseUrl}/api/dashboard/summary`, {
      headers: withCookie(cookie),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { role: string };
    expect(body.role).toBe("guest");
  });

  it("does not leak other projects into a guest's dashboard", async () => {
    // The scope resolver must not fall into the "unrestricted" path.
    await createProject({
      solutionName: OTHER_PROJECT,
      namespace: OTHER_PROJECT,
      language: "csharp",
    });
    const cookie = await startGuest();
    const res = await fetch(`${baseUrl}/api/dashboard/summary`, {
      headers: withCookie(cookie),
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(OTHER_PROJECT);
  });

  it("keeps guests out of the admin user list", async () => {
    // `AdminUser.role` has no `guest` member on purpose, so a guest row
    // reaching that response 500s the Memento Admin's Users page (their
    // branch selects every row). Guests are throwaway identities, not
    // accounts, and must be filtered out.
    await provisionUser({ username: ADMIN_USERNAME, role: "memento_admin" });
    const adminCookie = await login(baseUrl, ADMIN_USERNAME);
    await startGuest();

    const res = await fetch(`${baseUrl}/api/users`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const users = (await res.json()) as Array<{
      username: string;
      role: string;
    }>;
    expect(users.some((u) => u.role === "guest")).toBe(false);
    expect(users.some((u) => u.username.startsWith(GUEST_PREFIX))).toBe(false);
    // Sanity: the admin itself is still listed, so we didn't just get [].
    expect(users.some((u) => u.username === ADMIN_USERNAME)).toBe(true);
  });

  it("cannot see another guest's project", async () => {
    const first = await startGuest();
    expect((await createAsGuest(first, GUEST_PROJECT)).status).toBe(201);

    const second = await startGuest();
    const res = await fetch(`${baseUrl}/api/projects/available`, {
      headers: withCookie(second),
    });
    expect(await res.json()).toEqual([]);
  });
});

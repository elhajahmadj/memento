import { describe, it, expect, afterEach } from "vitest";
import { like } from "drizzle-orm";
import { db, guestSessionsTable, usersTable, type User } from "@workspace/db";
import type { Request } from "express";
import {
  canSeeProject,
  filterVisibleProjectNames,
  resolveScopePolicy,
  scopedProjectNames,
} from "@/features/auth/infrastructure/orgScope";

/**
 * Guest project visibility.
 *
 * The regression these tests exist for: `resolveScopePolicy` returns
 * `{ kind: "all" }` for any non-OIDC user. A guest is not an OIDC user,
 * so without an explicit branch ahead of that check a guest would see
 * every project in the workspace — including other tenants' work.
 */

/**
 * Deliberately NOT prefixed `guest-`: vitest runs test files in
 * parallel, and `guestSessionService.test.ts` cleans up with
 * `username LIKE 'guest-%'`. A `guest-orgscope-` prefix here would be
 * deleted out from under this file mid-test by that sibling's
 * afterEach, producing a bogus foreign-key failure.
 */
const PREFIX = "orgscope-gst-";

/** Monotonic suffix so two guests in one file can't collide. */
let seq = 0;

async function cleanup(): Promise<void> {
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
}

afterEach(cleanup);

async function makeGuest(projectName: string | null): Promise<User> {
  const [user] = await db
    .insert(usersTable)
    .values({
      username: `${PREFIX}${++seq}-${projectName ?? "none"}`,
      role: "guest",
      authSource: "guest",
    })
    .returning();
  await db.insert(guestSessionsTable).values({
    userId: user!.id,
    projectName,
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
  });
  return user!;
}

function makeReq(user: User): Request {
  return { user, session: {}, header: () => undefined } as unknown as Request;
}

describe("resolveScopePolicy for guests", () => {
  it("resolves to the guest policy, NOT the local-user 'all' policy", async () => {
    const guest = await makeGuest("GuestOwned");
    const policy = await resolveScopePolicy(makeReq(guest));
    expect(policy.kind).toBe("guest");
    if (policy.kind !== "guest") return;
    expect(policy.projectName).toBe("GuestOwned");
  });

  it("carries a null project until the guest creates one", async () => {
    const guest = await makeGuest(null);
    const policy = await resolveScopePolicy(makeReq(guest));
    expect(policy).toEqual({ kind: "guest", projectName: null });
  });
});

describe("canSeeProject under the guest policy", () => {
  it("sees its own project and nothing else", async () => {
    const policy = { kind: "guest" as const, projectName: "GuestOwned" };
    expect(await canSeeProject(policy, "GuestOwned")).toBe(true);
    expect(await canSeeProject(policy, "SomeoneElsesProject")).toBe(false);
    // Unowned local-user projects are the ones a naive "all" policy
    // would have exposed.
    expect(await canSeeProject(policy, "AdminScaffolded")).toBe(false);
  });

  it("sees nothing before it has a project", async () => {
    const policy = { kind: "guest" as const, projectName: null };
    expect(await canSeeProject(policy, "AnythingAtAll")).toBe(false);
  });
});

describe("filterVisibleProjectNames under the guest policy", () => {
  it("narrows a full workspace listing down to the guest's one project", async () => {
    const policy = { kind: "guest" as const, projectName: "GuestOwned" };
    const visible = await filterVisibleProjectNames(policy, [
      "AdminScaffolded",
      "GuestOwned",
      "AnotherTenant",
    ]);
    expect([...visible]).toEqual(["GuestOwned"]);
  });

  it("returns an empty set when the guest has no project yet", async () => {
    const policy = { kind: "guest" as const, projectName: null };
    const visible = await filterVisibleProjectNames(policy, [
      "AdminScaffolded",
      "AnotherTenant",
    ]);
    expect(visible.size).toBe(0);
  });

  it("does not invent a project that is absent from the listing", async () => {
    // The slot names a project that no longer exists on disk (mid-reap).
    const policy = { kind: "guest" as const, projectName: "AlreadyReaped" };
    const visible = await filterVisibleProjectNames(policy, [
      "AdminScaffolded",
    ]);
    expect(visible.size).toBe(0);
  });
});

describe("scopedProjectNames", () => {
  /**
   * Regression guard for the bug class that produced three separate
   * defects: call sites branching on `policy.kind === "org"` with an
   * implicit else silently mishandled `guest`. Depending on which way
   * the else fell, a guest either saw nothing (their own project
   * vanished from /projects/available and /projects/current) or saw
   * everything (the dashboard computed widgets over every project in
   * the workspace). This resolver is the single place that decision
   * should now live.
   */
  it("restricts a guest to their own project", async () => {
    expect(
      await scopedProjectNames({ kind: "guest", projectName: "GuestOwned" }),
    ).toEqual(["GuestOwned"]);
  });

  it("restricts a guest with no project to nothing — NOT to everything", async () => {
    // The dashboard treats `null` as "no restriction". Returning null
    // here is what leaked every project name onto a guest's home page.
    const names = await scopedProjectNames({
      kind: "guest",
      projectName: null,
    });
    expect(names).not.toBeNull();
    expect(names).toEqual([]);
  });

  it("returns null (unrestricted) only for local users", async () => {
    expect(await scopedProjectNames({ kind: "all" })).toBeNull();
  });

  it("returns an empty list for a scopeless SSO user", async () => {
    expect(await scopedProjectNames({ kind: "none" })).toEqual([]);
  });
});

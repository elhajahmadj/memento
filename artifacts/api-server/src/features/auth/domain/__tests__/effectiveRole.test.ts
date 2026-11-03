import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { like, or } from "drizzle-orm";
import {
  db,
  organizationsTable,
  userOrganizationsTable,
  usersTable,
  type User,
} from "@workspace/db";
import {
  isLocalUser,
  resolveEffectiveRole,
  resolveEffectiveRoleFromMemberships,
} from "../effectiveRole";

const PREFIX = "vitest-effrole-";

async function cleanup() {
  await db
    .delete(usersTable)
    .where(
      or(
        like(usersTable.username, `${PREFIX}%`),
        like(usersTable.username, `oidc:${PREFIX}%`),
      ),
    );
  await db
    .delete(organizationsTable)
    .where(like(organizationsTable.externalKey, `${PREFIX}%`));
}

beforeAll(cleanup);
afterEach(cleanup);

async function makeOrg(suffix: string): Promise<string> {
  const [row] = await db
    .insert(organizationsTable)
    .values({
      externalKey: `${PREFIX}${suffix}`,
      displayName: `${PREFIX}${suffix}`,
    })
    .returning();
  return row!.id;
}

async function makeUser(
  username: string,
  role: User["role"],
  authSource: User["authSource"] = "oidc",
): Promise<User> {
  const [u] = await db
    .insert(usersTable)
    .values({
      username: `${PREFIX}${username}`,
      role,
      authSource,
      profile: {},
    })
    .returning();
  return u!;
}

describe("isLocalUser", () => {
  it("returns true for users whose authSource is not 'oidc'", () => {
    expect(isLocalUser({ authSource: "local" })).toBe(true);
  });
  it("returns false for SSO users", () => {
    expect(isLocalUser({ authSource: "oidc" })).toBe(false);
  });
});

describe("resolveEffectiveRoleFromMemberships (pure)", () => {
  it("returns memento_admin for the god-mode super role regardless of active org", () => {
    const role = resolveEffectiveRoleFromMemberships(
      { role: "memento_admin", authSource: "oidc" },
      null,
      [],
    );
    expect(role).toBe("memento_admin");
  });

  it("returns users.role for local users (pre-org global view)", () => {
    const role = resolveEffectiveRoleFromMemberships(
      { role: "admin", authSource: "local" },
      null,
      [],
    );
    expect(role).toBe("admin");
  });

  it("returns the per-org membership role for an SSO user with an active org", () => {
    const role = resolveEffectiveRoleFromMemberships(
      { role: "limited", authSource: "oidc" },
      "org-a",
      [
        { organizationId: "org-a", role: "admin" },
        { organizationId: "org-b", role: "limited_admin" },
      ],
    );
    expect(role).toBe("admin");
  });

  it("flips the resolved role when the active org changes", () => {
    const memberships = [
      { organizationId: "org-a", role: "admin" as const },
      { organizationId: "org-b", role: "limited_admin" as const },
    ];
    const a = resolveEffectiveRoleFromMemberships(
      { role: "limited", authSource: "oidc" },
      "org-a",
      memberships,
    );
    const b = resolveEffectiveRoleFromMemberships(
      { role: "limited", authSource: "oidc" },
      "org-b",
      memberships,
    );
    expect(a).toBe("admin");
    expect(b).toBe("limited_admin");
  });

  it("returns null for an SSO user with no active org", () => {
    const role = resolveEffectiveRoleFromMemberships(
      { role: "limited", authSource: "oidc" },
      null,
      [{ organizationId: "org-a", role: "admin" }],
    );
    expect(role).toBeNull();
  });

  it("returns null when active org has no matching membership row", () => {
    const role = resolveEffectiveRoleFromMemberships(
      { role: "limited", authSource: "oidc" },
      "org-revoked",
      [{ organizationId: "org-a", role: "admin" }],
    );
    expect(role).toBeNull();
  });
});

describe("resolveEffectiveRole (IO)", () => {
  it("returns memento_admin without touching the DB", async () => {
    const u = await makeUser("godmode", "memento_admin");
    expect(await resolveEffectiveRole(u, null)).toBe("memento_admin");
  });

  it("returns users.role for local users without touching memberships", async () => {
    const u = await makeUser("local-admin", "admin", "local");
    expect(await resolveEffectiveRole(u, null)).toBe("admin");
  });

  it("resolves the SSO user's role from user_organizations for the active org", async () => {
    const orgA = await makeOrg("io-a");
    const orgB = await makeOrg("io-b");
    const u = await makeUser("sso-multi", "limited");
    await db.insert(userOrganizationsTable).values([
      { userId: u.id, organizationId: orgA, role: "admin" },
      { userId: u.id, organizationId: orgB, role: "limited_admin" },
    ]);
    expect(await resolveEffectiveRole(u, orgA)).toBe("admin");
    expect(await resolveEffectiveRole(u, orgB)).toBe("limited_admin");
  });

  it("returns null for an SSO user with no active org pinned", async () => {
    const orgA = await makeOrg("io-no-active");
    const u = await makeUser("sso-no-active", "limited");
    await db
      .insert(userOrganizationsTable)
      .values({ userId: u.id, organizationId: orgA, role: "admin" });
    expect(await resolveEffectiveRole(u, null)).toBeNull();
  });

  it("returns null when active org is no longer a membership (revoked)", async () => {
    const orgA = await makeOrg("io-revoked-a");
    const orgB = await makeOrg("io-revoked-b");
    const u = await makeUser("sso-revoked", "limited");
    await db
      .insert(userOrganizationsTable)
      .values({ userId: u.id, organizationId: orgA, role: "admin" });
    // Session still points at orgB but the IDP never granted membership.
    expect(await resolveEffectiveRole(u, orgB)).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { eq, like, or } from "drizzle-orm";
import {
  db,
  organizationsTable,
  projectOrganizationsTable,
  userOrganizationsTable,
  usersTable,
} from "@workspace/db";
import {
  normalizeClaims,
  pickRoleFromClaims,
  provisionFromClaims,
  listOrgsForUser,
} from "@/features/auth/infrastructure/oidcProvider";
import {
  filterVisibleProjectNames,
  type ScopePolicy,
} from "@/features/auth/infrastructure/orgScope";

const TEST_PREFIX = "vitest-oidc-";

async function cleanup() {
  // Delete users created by this suite (cascades to user_organizations).
  await db
    .delete(usersTable)
    .where(
      or(
        like(usersTable.username, `${TEST_PREFIX}%`),
        like(usersTable.username, `oidc:${TEST_PREFIX}%`),
        like(usersTable.oidcSubject, `${TEST_PREFIX}%`),
      ),
    );
  await db
    .delete(organizationsTable)
    .where(like(organizationsTable.externalKey, `${TEST_PREFIX}%`));
  await db
    .delete(projectOrganizationsTable)
    .where(like(projectOrganizationsTable.projectName, `${TEST_PREFIX}%`));
}

beforeAll(cleanup);
afterEach(cleanup);

describe("OIDC provisioning", () => {
  it("normalizes claims with a single-string org claim", () => {
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-1`,
        email: "u@example.com",
        given_name: "Test",
        family_name: "User",
        org: `${TEST_PREFIX}org-a`,
      },
      "org",
    );
    expect(norm.subject).toBe(`${TEST_PREFIX}sub-1`);
    expect(norm.email).toBe("u@example.com");
    expect(norm.firstName).toBe("Test");
    expect(norm.orgKeys).toEqual([`${TEST_PREFIX}org-a`]);
  });

  it("normalizes claims with an array org claim and de-dupes", () => {
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-2`,
        groups: [
          `${TEST_PREFIX}org-a`,
          `${TEST_PREFIX}org-b`,
          `${TEST_PREFIX}org-a`,
        ],
      },
      "groups",
    );
    expect(norm.orgKeys.sort()).toEqual(
      [`${TEST_PREFIX}org-a`, `${TEST_PREFIX}org-b`].sort(),
    );
  });

  it("provisions a new IDP user, creates orgs, and syncs memberships", async () => {
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-3`,
        email: "p@example.com",
        org: [`${TEST_PREFIX}org-a`, `${TEST_PREFIX}org-b`],
      },
      "org",
    );
    const { user, orgs } = await provisionFromClaims(norm);
    // Usernames for OIDC users live in the `oidc:` namespace so they
    // can never collide with (or take over) a local user's username.
    // Identity matching uses `oidc_subject`, not the username.
    expect(user.username).toBe(`oidc:${TEST_PREFIX}sub-3`);
    expect(user.oidcSubject).toBe(`${TEST_PREFIX}sub-3`);
    expect(user.role).toBe("limited");
    expect(orgs.map((o) => o.externalKey).sort()).toEqual(
      [`${TEST_PREFIX}org-a`, `${TEST_PREFIX}org-b`].sort(),
    );
    const persisted = await listOrgsForUser(user.id);
    expect(persisted.length).toBe(2);
  });

  it("pickRoleFromClaims picks the highest-privilege value (Admin > Limited Admin > User)", () => {
    expect(
      pickRoleFromClaims(
        { roles: ["User", "Admin", "Limited Admin"] },
        "roles",
      ),
    ).toBe("admin");
    expect(
      pickRoleFromClaims({ roles: ["User", "Limited Admin"] }, "roles"),
    ).toBe("limited_admin");
    expect(pickRoleFromClaims({ roles: ["User"] }, "roles")).toBe("limited");
  });

  it("pickRoleFromClaims accepts the three canonical Nexus role names case-insensitively, defaults to limited", () => {
    expect(pickRoleFromClaims({ roles: "Admin" }, "roles")).toBe("admin");
    expect(pickRoleFromClaims({ roles: "ADMIN" }, "roles")).toBe("admin");
    expect(pickRoleFromClaims({ roles: "Limited Admin" }, "roles")).toBe(
      "limited_admin",
    );
    expect(pickRoleFromClaims({ roles: "  limited   admin  " }, "roles")).toBe(
      "limited_admin",
    );
    expect(pickRoleFromClaims({ roles: "User" }, "roles")).toBe("limited");
    // Legacy alternate spellings are no longer recognized.
    expect(pickRoleFromClaims({ roles: "limited_admin" }, "roles")).toBe(
      "limited",
    );
    expect(pickRoleFromClaims({ roles: "limitedadmin" }, "roles")).toBe(
      "limited",
    );
    expect(pickRoleFromClaims({ roles: "limited-admin" }, "roles")).toBe(
      "limited",
    );
    expect(pickRoleFromClaims({ roles: "limited" }, "roles")).toBe("limited");
    // Missing claim, empty array, and unknown values all fall back to
    // least-privilege so an unprivileged user never accidentally gets Admin.
    expect(pickRoleFromClaims({}, "roles")).toBe("limited");
    expect(pickRoleFromClaims({ roles: [] }, "roles")).toBe("limited");
    expect(pickRoleFromClaims({ roles: ["wizard"] }, "roles")).toBe("limited");
  });

  it("normalizeClaims falls back to roles nested inside organizations[] entries (Nexus shape)", () => {
    // Nexus emits an empty top-level `roles` claim and packages the
    // user's role inside each `organizations[]` entry as a `roles`
    // string array.
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-org-roles-1`,
        organizations: [
          {
            id: `${TEST_PREFIX}org-orn`,
            name: "Acme",
            slug: "acme",
            roles: ["Admin"],
          },
        ],
        roles: [],
      },
      "organizations",
    );
    expect(norm.role).toBe("admin");
  });

  it("normalizeClaims picks the highest privilege across multiple orgs' nested roles", () => {
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-org-roles-2`,
        organizations: [
          { id: `${TEST_PREFIX}org-a`, roles: ["User"] },
          { id: `${TEST_PREFIX}org-b`, roles: ["Limited Admin"] },
        ],
        roles: [],
      },
      "organizations",
    );
    expect(norm.role).toBe("limited_admin");
  });

  it("normalizeClaims accepts org-nested roles emitted as objects with a name field", () => {
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-org-roles-3`,
        organizations: [
          {
            id: `${TEST_PREFIX}org-c`,
            roles: [{ id: "r1", name: "Admin" }],
          },
        ],
      },
      "organizations",
    );
    expect(norm.role).toBe("admin");
  });

  it("normalizeClaims still prefers the top-level roles claim when it has a recognized value", () => {
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-org-roles-4`,
        organizations: [
          { id: `${TEST_PREFIX}org-d`, roles: ["User"] },
        ],
        roles: ["Admin"],
      },
      "organizations",
    );
    expect(norm.role).toBe("admin");
  });

  it("normalizeClaims prefers an explicit top-level User over nested org Admin (no privilege escalation)", () => {
    // Security regression: an IDP that intentionally downgrades a
    // user to top-level `User` MUST win over a stale per-org `Admin`
    // membership. Only an empty/missing top-level claim falls through
    // to org-nested roles.
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-org-roles-5`,
        organizations: [
          { id: `${TEST_PREFIX}org-e`, roles: ["Admin"] },
        ],
        roles: ["User"],
      },
      "organizations",
    );
    expect(norm.role).toBe("limited");
  });

  it("normalizeClaims falls through to org-nested roles when the top-level claim has only unrecognized values", () => {
    // An unrecognized top-level value (typo, removed role) is treated
    // the same as missing — fall through to org-nested roles rather
    // than silently dropping the user to least-privilege.
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-org-roles-6`,
        organizations: [
          { id: `${TEST_PREFIX}org-f`, roles: ["Admin"] },
        ],
        roles: ["wizard"],
      },
      "organizations",
    );
    expect(norm.role).toBe("admin");
  });

  it("normalizeClaims surfaces hasMementoUserClaim from the Nexus namespace (case-sensitive)", () => {
    // Happy path: namespace object carries mementoUser:true.
    const ok = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-ns-1`,
        "https://nexus/claims": { mementoUser: true, roles: ["Admin"] },
      },
      "organizations",
    );
    expect(ok.nexusNamespacePresent).toBe(true);
    expect(ok.hasMementoUserClaim).toBe(true);
    expect(ok.role).toBe("admin");

    // Same payload but the case-sensitive key is wrong — gate fails.
    const wrongCase = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-ns-2`,
        "https://nexus/claims": { mementouser: true, roles: ["Admin"] },
      },
      "organizations",
    );
    expect(wrongCase.nexusNamespacePresent).toBe(true);
    expect(wrongCase.hasMementoUserClaim).toBe(false);

    // Namespace absent, claim is at top level — also accepted so a
    // non-Nexus IDP can opt in.
    const topLevel = normalizeClaims(
      { sub: `${TEST_PREFIX}sub-ns-3`, mementoUser: true },
      "organizations",
    );
    expect(topLevel.nexusNamespacePresent).toBe(false);
    expect(topLevel.hasMementoUserClaim).toBe(true);
  });

  it("normalizeClaims gates mementoAccessOrgKeys on the per-org access claim (case-sensitive)", () => {
    // Org entry with the access claim → key appears in the set.
    const granted = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-ga-1`,
        organizations: [
          {
            id: `${TEST_PREFIX}org-bound`,
            name: "Bound",
            mementoAccess: true,
          },
        ],
        "https://nexus/claims": { mementoUser: true, roles: ["User"] },
      },
      "organizations",
    );
    expect([...granted.mementoAccessOrgKeys]).toEqual([
      `${TEST_PREFIX}org-bound`,
    ]);

    // Org entry with NO access claim → empty set.
    const denied = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-ga-2`,
        organizations: [{ id: `${TEST_PREFIX}org-bound`, name: "Bound" }],
        "https://nexus/claims": { mementoUser: true, roles: ["User"] },
      },
      "organizations",
    );
    expect(denied.mementoAccessOrgKeys.size).toBe(0);

    // Wrong-case access claim → denied.
    const wrongCase = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-ga-3`,
        organizations: [
          { id: `${TEST_PREFIX}org-bound`, mementoaccess: true },
        ],
        "https://nexus/claims": { mementoUser: true },
      },
      "organizations",
    );
    expect(wrongCase.mementoAccessOrgKeys.size).toBe(0);

    // Mixed list: only granting entries make it through.
    const mixed = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-ga-4`,
        organizations: [
          { id: `${TEST_PREFIX}org-grant-a`, mementoAccess: true },
          { id: `${TEST_PREFIX}org-deny-b` },
          { id: `${TEST_PREFIX}org-grant-c`, mementoAccess: true },
        ],
        "https://nexus/claims": { mementoUser: true },
      },
      "organizations",
    );
    expect([...mixed.mementoAccessOrgKeys].sort()).toEqual(
      [`${TEST_PREFIX}org-grant-a`, `${TEST_PREFIX}org-grant-c`].sort(),
    );

    // No orgs at all → empty set.
    const noOrgs = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-ga-5`,
        "https://nexus/claims": { mementoUser: true },
      },
      "organizations",
    );
    expect(noOrgs.mementoAccessOrgKeys.size).toBe(0);

    // Top-level mementoAccess (the old shape) is ignored.
    const flatTopLevel = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-ga-6`,
        mementoAccess: true,
        organizations: [{ id: `${TEST_PREFIX}org-bound`, name: "Bound" }],
        "https://nexus/claims": { mementoUser: true },
      },
      "organizations",
    );
    expect(flatTopLevel.mementoAccessOrgKeys.size).toBe(0);
  });

  it("normalizeClaims env overrides remap all three claim names", () => {
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-ov-1`,
        organizations: [
          { id: `${TEST_PREFIX}org-ov`, customAccess: true },
        ],
        "https://custom/ns": { customUser: true, roles: ["Admin"] },
      },
      "organizations",
      "roles",
      {
        userClaimsNamespace: "https://custom/ns",
        mementoUserClaim: "customUser",
        mementoAccessClaim: "customAccess",
        mementoGodModeAccessClaim: "mementoAccess",
        mementoGodModeRoleClaim: "mementoGodMode",
        mementoGodModeRoleValue: "mementoAdmin",
        mementoGodModeTierClaim: "NexusTier reserved",
        mementoGodModeTierValue: "NexusAdmin",
      },
    );
    expect(norm.nexusNamespacePresent).toBe(true);
    expect(norm.hasMementoUserClaim).toBe(true);
    expect(norm.role).toBe("admin");
    expect([...norm.mementoAccessOrgKeys]).toEqual([`${TEST_PREFIX}org-ov`]);
  });

  it("normalizeClaims threads the configured roles claim into role mapping", () => {
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-roles-1`,
        org: `${TEST_PREFIX}org-r`,
        memento_roles: ["admin"],
      },
      "org",
      "memento_roles",
    );
    expect(norm.role).toBe("admin");
  });

  it("provisionFromClaims re-applies the IDP role on every login (per-org)", async () => {
    // Per-org roles model: `users.role` for SSO users is a neutral
    // baseline (`limited`) unless they are Memento Admin. The actual
    // role drifts live on `user_organizations.role`, which is
    // re-applied on every sign-in so a role change in the IDP takes
    // effect on the user's next login.
    async function membershipRoleFor(userId: string): Promise<string | null> {
      const rows = await db
        .select({ role: userOrganizationsTable.role })
        .from(userOrganizationsTable)
        .innerJoin(
          organizationsTable,
          eq(organizationsTable.id, userOrganizationsTable.organizationId),
        )
        .where(eq(userOrganizationsTable.userId, userId));
      return rows[0]?.role ?? null;
    }

    // First sign-in: claim says Limited Admin.
    const first = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-role-resync`,
        org: `${TEST_PREFIX}org-rr`,
        roles: ["Limited Admin"],
      },
      "org",
    );
    const { user: u1 } = await provisionFromClaims(first);
    // users.role is the neutral baseline for non-memento-admin SSO users.
    expect(u1.role).toBe("limited");
    expect(await membershipRoleFor(u1.id)).toBe("limited_admin");

    // Second sign-in: claim now says Admin — per-org row must promote.
    const second = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-role-resync`,
        org: `${TEST_PREFIX}org-rr`,
        roles: ["Admin"],
      },
      "org",
    );
    const { user: u2 } = await provisionFromClaims(second);
    expect(u2.id).toBe(u1.id);
    expect(u2.role).toBe("limited");
    expect(await membershipRoleFor(u1.id)).toBe("admin");

    // Third sign-in: claim drops back to User — per-org row must demote.
    const third = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-role-resync`,
        org: `${TEST_PREFIX}org-rr`,
        roles: ["User"],
      },
      "org",
    );
    const { user: u3 } = await provisionFromClaims(third);
    expect(u3.id).toBe(u1.id);
    expect(u3.role).toBe("limited");
    expect(await membershipRoleFor(u1.id)).toBe("limited");
  });

  it("provisionFromClaims writes per-org roles when a user has different roles across orgs", async () => {
    // Per-org roles task: an "Admin in OrgA, Limited Admin in OrgB"
    // user must land in the DB with the correct role on each
    // membership row. The legacy "highest wins across all orgs"
    // model would have written Admin on both rows, silently
    // elevating OrgB.
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-multi`,
        organizations: [
          {
            id: `${TEST_PREFIX}org-multi-a`,
            name: "MultiA",
            roles: ["Admin"],
          },
          {
            id: `${TEST_PREFIX}org-multi-b`,
            name: "MultiB",
            roles: ["Limited Admin"],
          },
        ],
        roles: [],
      },
      "organizations",
    );
    const { user, orgs } = await provisionFromClaims(norm);
    // users.role is the neutral baseline; the org rows carry the
    // authority.
    expect(user.role).toBe("limited");
    const byKey = new Map(orgs.map((o) => [o.externalKey, o.id] as const));
    const rows = await db
      .select({
        orgId: userOrganizationsTable.organizationId,
        role: userOrganizationsTable.role,
        idpRole: userOrganizationsTable.idpRole,
      })
      .from(userOrganizationsTable)
      .where(eq(userOrganizationsTable.userId, user.id));
    const byOrg = new Map(rows.map((r) => [r.orgId, r] as const));
    expect(byOrg.get(byKey.get(`${TEST_PREFIX}org-multi-a`)!)?.role).toBe(
      "admin",
    );
    expect(byOrg.get(byKey.get(`${TEST_PREFIX}org-multi-b`)!)?.role).toBe(
      "limited_admin",
    );
    // The raw IDP role is captured per-org for auditability.
    expect(byOrg.get(byKey.get(`${TEST_PREFIX}org-multi-a`)!)?.idpRole).toBe(
      "Admin",
    );
    expect(byOrg.get(byKey.get(`${TEST_PREFIX}org-multi-b`)!)?.idpRole).toBe(
      "Limited Admin",
    );
  });

  it("provisionFromClaims keeps Memento Admin on users.role and falls back to limited on membership rows", async () => {
    // Memento Admin is the only role that lives on `users.role` for
    // SSO users — it's a god-mode super role that exists outside any
    // org. The per-org enum has no `memento_admin` value, so the
    // membership row falls back to `limited` (the baseline).
    const norm = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-godmode`,
        "https://nexus/claims": {
          mementoUser: true,
          mementoAdmin: true,
          roles: ["Memento Admin"],
        },
        organizations: [
          { id: `${TEST_PREFIX}org-god`, mementoAccess: true },
        ],
      },
      "organizations",
    );
    const { user } = await provisionFromClaims(norm);
    expect(user.role).toBe("memento_admin");
    const rows = await db
      .select({ role: userOrganizationsTable.role })
      .from(userOrganizationsTable)
      .where(eq(userOrganizationsTable.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("limited");
  });

  it("re-provisioning syncs membership: drops removed orgs, keeps shared", async () => {
    const initial = normalizeClaims(
      {
        sub: `${TEST_PREFIX}sub-4`,
        org: [`${TEST_PREFIX}org-a`, `${TEST_PREFIX}org-b`],
      },
      "org",
    );
    await provisionFromClaims(initial);

    const reduced = normalizeClaims(
      { sub: `${TEST_PREFIX}sub-4`, org: [`${TEST_PREFIX}org-b`] },
      "org",
    );
    const { user } = await provisionFromClaims(reduced);
    const persisted = await listOrgsForUser(user.id);
    expect(persisted.map((o) => o.externalKey)).toEqual([
      `${TEST_PREFIX}org-b`,
    ]);
  });
});

describe("Org-scope project filtering", () => {
  async function makeOrg(key: string) {
    const [o] = await db
      .insert(organizationsTable)
      .values({ externalKey: `${TEST_PREFIX}${key}`, displayName: key })
      .returning();
    return o!;
  }

  async function stamp(name: string, orgId: string) {
    await db
      .insert(projectOrganizationsTable)
      .values({ projectName: `${TEST_PREFIX}${name}`, organizationId: orgId });
  }

  it("policy 'all' (local user) sees every project, owned or unowned", async () => {
    const a = await makeOrg("policy-all-a");
    await stamp("policy-all-p1", a.id);
    const policy: ScopePolicy = { kind: "all" };
    const visible = await filterVisibleProjectNames(policy, [
      `${TEST_PREFIX}policy-all-p1`,
      `${TEST_PREFIX}policy-all-unowned`,
    ]);
    expect(visible.size).toBe(2);
  });

  it("policy 'org' sees only projects stamped with that org", async () => {
    const a = await makeOrg("policy-org-a");
    const b = await makeOrg("policy-org-b");
    await stamp("policy-org-p1", a.id);
    await stamp("policy-org-p2", b.id);
    const policy: ScopePolicy = { kind: "org", orgId: a.id };
    const visible = await filterVisibleProjectNames(policy, [
      `${TEST_PREFIX}policy-org-p1`,
      `${TEST_PREFIX}policy-org-p2`,
      `${TEST_PREFIX}policy-org-unowned`,
    ]);
    expect([...visible]).toEqual([`${TEST_PREFIX}policy-org-p1`]);
  });

  it("policy 'none' sees nothing", async () => {
    const a = await makeOrg("policy-none-a");
    await stamp("policy-none-p1", a.id);
    const policy: ScopePolicy = { kind: "none" };
    const visible = await filterVisibleProjectNames(policy, [
      `${TEST_PREFIX}policy-none-p1`,
    ]);
    expect(visible.size).toBe(0);
  });

  it("listOrgsForUser returns [] for users with no IDP membership (local users)", async () => {
    const norm = normalizeClaims(
      { sub: `${TEST_PREFIX}sub-local-only`, org: [`${TEST_PREFIX}org-only`] },
      "org",
    );
    await provisionFromClaims(norm);
    // Find a user that has zero memberships (a synthetic local user).
    const [localUser] = await db
      .insert(usersTable)
      .values({
        username: `${TEST_PREFIX}local-user`,
        role: "admin",
        passwordHash: "x",
        profile: {},
      })
      .returning();
    const orgs = await listOrgsForUser(localUser!.id);
    expect(orgs).toEqual([]);
    await db.delete(usersTable).where(eq(usersTable.id, localUser!.id));
  });
});

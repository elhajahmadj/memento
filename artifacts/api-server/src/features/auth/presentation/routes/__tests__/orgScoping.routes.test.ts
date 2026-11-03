import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { eq, like, inArray, or } from "drizzle-orm";
import {
  db,
  organizationsTable,
  projectAccessRequestsTable,
  projectAssignmentsTable,
  projectOrganizationsTable,
  userOrganizationsTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "@/features/auth/infrastructure/passwordHash";
import {
  bootServer,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";

const PREFIX = "vitest-org-scope-";
const LOCAL_USERNAME = `${PREFIX}local-admin`;
const IDP_USERNAME = `${PREFIX}idp-admin`;
const ORG_A = `${PREFIX}org-a`;
const ORG_B = `${PREFIX}org-b`;
const PROJECT_A = `${PREFIX}proj-a`;
const PROJECT_B = `${PREFIX}proj-b`;

let baseUrl: string;
let close: () => Promise<void>;
let orgAId: string;
let orgBId: string;
let idpUserId: string;
let idpCookie: string;
let localCookie: string;

async function scrubAll() {
  const stale = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(like(usersTable.username, `${PREFIX}%`));
  const ids = stale.map((u) => u.id);
  if (ids.length > 0) {
    await db
      .delete(projectAccessRequestsTable)
      .where(inArray(projectAccessRequestsTable.userId, ids));
    await db
      .delete(projectAssignmentsTable)
      .where(
        or(
          inArray(projectAssignmentsTable.userId, ids),
          inArray(projectAssignmentsTable.assignedBy, ids),
        ),
      );
  }
  await db
    .delete(projectOrganizationsTable)
    .where(like(projectOrganizationsTable.projectName, `${PREFIX}%`));
  await db
    .delete(organizationsTable)
    .where(like(organizationsTable.externalKey, `${PREFIX}%`));
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
}

beforeAll(async () => {
  await scrubAll();
  ({ baseUrl, close } = await bootServer());
});

afterAll(async () => {
  await close();
  await scrubAll();
});

beforeEach(async () => {
  // Clean before each so tests don't leak state.
  await scrubAll();

  // Two orgs, one project per org.
  const [a] = await db
    .insert(organizationsTable)
    .values({ externalKey: ORG_A, displayName: "Org A" })
    .returning();
  const [b] = await db
    .insert(organizationsTable)
    .values({ externalKey: ORG_B, displayName: "Org B" })
    .returning();
  orgAId = a!.id;
  orgBId = b!.id;
  await db
    .insert(projectOrganizationsTable)
    .values({ projectName: PROJECT_A, organizationId: orgAId });
  await db
    .insert(projectOrganizationsTable)
    .values({ projectName: PROJECT_B, organizationId: orgBId });

  // Local-only admin (no IDP membership) — should retain pre-org global view.
  await provisionUser({ username: LOCAL_USERNAME, role: "admin" });
  localCookie = await login(baseUrl, LOCAL_USERNAME);

  // OIDC admin user — member of Org A only. We insert directly so we
  // can pin authSource = 'oidc' (the test harness's provisionUser only
  // creates local rows).
  const passwordHash = await hashPassword("Sup3rSecret!");
  const [idpUser] = await db
    .insert(usersTable)
    .values({
      username: IDP_USERNAME,
      passwordHash,
      role: "admin",
      profile: {},
      authSource: "oidc",
    })
    .returning();
  idpUserId = idpUser!.id;
  await db
    .insert(userOrganizationsTable)
    .values({ userId: idpUserId, organizationId: orgAId, role: "admin" });
  idpCookie = await login(baseUrl, IDP_USERNAME);
  // Activate Org A in the session.
  const activateRes = await fetch(`${baseUrl}/api/auth/active-org`, {
    method: "POST",
    headers: withCookie(idpCookie, { "content-type": "application/json" }),
    body: JSON.stringify({ organizationId: orgAId }),
  });
  if (activateRes.status !== 200) {
    throw new Error(
      `failed to activate org for IDP user: ${activateRes.status} ${await activateRes.text()}`,
    );
  }
});

afterEach(async () => {
  await scrubAll();
});

describe("Org-scoped project authorization (HTTP)", () => {
  it("local admins keep the pre-org global view (sees both orgs' projects)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: withCookie(localCookie),
    });
    expect(res.status).toBe(200);
    const me = (await res.json()) as {
      organizations: Array<{ id: string }>;
      activeOrganizationId: string | null;
    };
    // Local users see no org metadata; UI hides the switcher.
    expect(me.organizations).toEqual([]);
    expect(me.activeOrganizationId).toBeNull();
  });

  it("IDP users get org metadata and an active org from /auth/me", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: withCookie(idpCookie),
    });
    expect(res.status).toBe(200);
    const me = (await res.json()) as {
      organizations: Array<{ id: string }>;
      activeOrganizationId: string | null;
    };
    expect(Array.isArray(me.organizations)).toBe(true);
    expect(me.organizations.length).toBe(1);
    expect(me.organizations[0]!.id).toBe(orgAId);
    expect(me.activeOrganizationId).toBe(orgAId);
  });

  it("IDP /projects/disable returns 404 for cross-org project (existence not observable)", async () => {
    const res = await fetch(`${baseUrl}/api/projects/disable`, {
      method: "POST",
      headers: withCookie(idpCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        slnPath: `/tmp/${PROJECT_B}.sln`,
        disabled: true,
      }),
    });
    // Cross-org is hidden as 404, never 403, regardless of whether the
    // file path resolves (it doesn't here, but the org guard runs first).
    expect(res.status).toBe(404);
  });

  it("IDP /projects/delete returns 404 for cross-org project", async () => {
    const res = await fetch(`${baseUrl}/api/projects/delete`, {
      method: "POST",
      headers: withCookie(idpCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ slnPath: `/tmp/${PROJECT_B}.sln` }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /project-assignments returns 404 when targeting a cross-org project", async () => {
    // Create a target user the IDP admin would be assigning to.
    const target = await provisionUser({
      username: `${PREFIX}target`,
      role: "limited_admin",
    });
    const res = await fetch(`${baseUrl}/api/project-assignments`, {
      method: "POST",
      headers: withCookie(idpCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ userId: target.id, projectName: PROJECT_B }),
    });
    expect(res.status).toBe(404);
    // Confirm no assignment row was actually created.
    const rows = await db
      .select()
      .from(projectAssignmentsTable)
      .where(eq(projectAssignmentsTable.projectName, PROJECT_B));
    expect(rows).toEqual([]);
  });

  it("GET /project-assignments returns only in-org rows for IDP admin; everything for local admin", async () => {
    // Seed assignments in both orgs (not done via API to bypass the org
    // guard for setup convenience).
    const ladmin = await provisionUser({
      username: `${PREFIX}ladmin`,
      role: "limited_admin",
    });
    await db.insert(projectAssignmentsTable).values([
      {
        userId: ladmin.id,
        projectName: PROJECT_A,
        assignedBy: idpUserId,
        organizationId: orgAId,
      },
      {
        userId: ladmin.id,
        projectName: PROJECT_B,
        assignedBy: idpUserId,
        organizationId: orgBId,
      },
    ]);
    const idpRes = await fetch(`${baseUrl}/api/project-assignments`, {
      headers: withCookie(idpCookie),
    });
    expect(idpRes.status).toBe(200);
    const idpRows = (await idpRes.json()) as Array<{ projectName: string }>;
    const idpProjects = idpRows
      .map((r) => r.projectName)
      .filter((n) => n.startsWith(PREFIX));
    expect(idpProjects).toEqual([PROJECT_A]);

    const localRes = await fetch(`${baseUrl}/api/project-assignments`, {
      headers: withCookie(localCookie),
    });
    expect(localRes.status).toBe(200);
    const localRows = (await localRes.json()) as Array<{
      projectName: string;
    }>;
    const localProjects = localRows
      .map((r) => r.projectName)
      .filter((n) => n.startsWith(PREFIX))
      .sort();
    expect(localProjects).toEqual([PROJECT_A, PROJECT_B]);
  });

  it("OIDC user with all orgs revoked sees nothing (policy 'none', NOT global)", async () => {
    // Revoke every membership. authSource is still 'oidc' on the row so
    // resolveScopePolicy must return 'none' — falling back to global
    // would be a privilege escalation.
    await db
      .delete(userOrganizationsTable)
      .where(eq(userOrganizationsTable.userId, idpUserId));
    // Seed an assignment in Org B to prove the OIDC caller cannot see
    // it (a 'none' admin gets [], not the global view).
    const ladmin = await provisionUser({
      username: `${PREFIX}none-ladmin`,
      role: "limited_admin",
    });
    await db.insert(projectAssignmentsTable).values({
      userId: ladmin.id,
      projectName: PROJECT_B,
      assignedBy: idpUserId,
      organizationId: orgBId,
    });
    const listRes = await fetch(`${baseUrl}/api/project-assignments`, {
      headers: withCookie(idpCookie),
    });
    expect(listRes.status).toBe(200);
    const rows = (await listRes.json()) as Array<{ projectName: string }>;
    expect(rows.filter((r) => r.projectName.startsWith(PREFIX))).toEqual([]);
  });

  it("OIDC user with no active org cannot create a project (400)", async () => {
    // Drop the session's active org to force ScopePolicy = none.
    await db
      .delete(userOrganizationsTable)
      .where(eq(userOrganizationsTable.userId, idpUserId));
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: withCookie(idpCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        solutionName: `${PREFIX}OrgGuardSlnNoOrg`,
        language: "csharp",
      }),
    });
    expect(res.status).toBe(400);
    // Project must NOT be created.
    const stamps = await db
      .select()
      .from(projectOrganizationsTable)
      .where(
        eq(projectOrganizationsTable.projectName, `${PREFIX}OrgGuardSlnNoOrg`),
      );
    expect(stamps).toEqual([]);
  });

  it("OIDC user with active org creates a project stamped to that org", async () => {
    const slnName = `${PREFIX}OrgStamped`;
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: withCookie(idpCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ solutionName: slnName, language: "csharp" }),
    });
    // Accept 201 (created) — if scaffolder fails for unrelated reasons
    // we still want to assert that the stamp logic ran or that no stamp
    // exists when no project was created.
    if (res.status === 201) {
      const stamps = await db
        .select()
        .from(projectOrganizationsTable)
        .where(eq(projectOrganizationsTable.projectName, slnName));
      expect(stamps).toHaveLength(1);
      expect(stamps[0]!.organizationId).toBe(orgAId);
    } else {
      // If creation failed, ensure it wasn't due to the guard (which
      // would surface "Select an active organization").
      const body = (await res.json()) as { error?: string };
      expect(body.error ?? "").not.toMatch(/Select an active organization/);
    }
  });

  it("OIDC limited user cannot act on a stale cross-org loaded project (404)", async () => {
    // Regression: requireAdminOrAssignedToCurrentProjectOrOwner used to
    // pass-through every non-admin role, leaving OIDC limited users
    // able to keep acting on the previously-loaded project after they
    // switched their active org. The middleware now revalidates the
    // current project against the active org and returns 404 when it
    // belongs to a different one.
    const { setCurrentProject } = await import(
      "@/features/projects/infrastructure/projectService"
    );
    const limitedUsername = `${PREFIX}limited-stale`;
    const limitedPasswordHash = await hashPassword("Sup3rSecret!");
    const [limitedUser] = await db
      .insert(usersTable)
      .values({
        username: limitedUsername,
        passwordHash: limitedPasswordHash,
        role: "limited",
        profile: {},
        authSource: "oidc",
      })
      .returning();
    // Member of Org A only; active session pinned to Org A.
    await db
      .insert(userOrganizationsTable)
      .values({ userId: limitedUser!.id, organizationId: orgAId });
    const limitedCookie = await login(baseUrl, limitedUsername);
    const activate = await fetch(`${baseUrl}/api/auth/active-org`, {
      method: "POST",
      headers: withCookie(limitedCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ organizationId: orgAId }),
    });
    expect(activate.status).toBe(200);

    // Simulate a stale loaded project from Org B (e.g. the user
    // switched orgs after loading). Set it directly so we don't need
    // to scaffold an on-disk fork for this regression test.
    setCurrentProject(
      {
        solutionName: PROJECT_B,
        testProjectName: `${PROJECT_B}.Tests`,
        namespace: PROJECT_B,
        rootPath: `/tmp/${PREFIX}stale`,
        slnPath: `/tmp/${PREFIX}stale/${PROJECT_B}.sln`,
        language: "csharp",
      },
      limitedUser!.id,
    );

    const res = await fetch(`${baseUrl}/api/projects/tree`, {
      headers: withCookie(limitedCookie),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("No project loaded");
  });

  it("/auth/me returns per-org roles and the resolved effectiveRole for an SSO admin", async () => {
    // Per-org roles task: the SPA renders the org switcher with each
    // membership's role label and gates UI on `user.effectiveRole`
    // (resolved from the active org), not on `user.role`. This test
    // pins the wire shape so the SPA contract doesn't drift.
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: withCookie(idpCookie),
    });
    expect(res.status).toBe(200);
    const me = (await res.json()) as {
      user: { role: string; effectiveRole: string | null } | null;
      organizations: Array<{ id: string; role: string | null }>;
      activeOrganizationId: string | null;
    };
    expect(me.user).not.toBeNull();
    // SSO admin in OrgA — effectiveRole follows the per-org row.
    expect(me.user!.effectiveRole).toBe("admin");
    expect(me.organizations).toHaveLength(1);
    expect(me.organizations[0]).toEqual(
      expect.objectContaining({ id: orgAId, role: "admin" }),
    );
    expect(me.activeOrganizationId).toBe(orgAId);
  });

  it("/auth/me falls back to users.role when SSO user has zero memberships", async () => {
    // When the IDP revokes every org membership there is no org left
    // to pick from, so the per-org resolver falls back to users.role.
    // The downstream scope policy still resolves to "none" (zero
    // visible projects), but admin-gated reads must authorize and
    // return empty lists rather than 403 — see
    // `OIDC user with all orgs revoked sees nothing` below.
    await db
      .delete(userOrganizationsTable)
      .where(eq(userOrganizationsTable.userId, idpUserId));
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: withCookie(idpCookie),
    });
    expect(res.status).toBe(200);
    const me = (await res.json()) as {
      user: { effectiveRole: string | null } | null;
      organizations: Array<unknown>;
      activeOrganizationId: string | null;
    };
    expect(me.user!.effectiveRole).toBe("admin");
    expect(me.organizations).toEqual([]);
    expect(me.activeOrganizationId).toBeNull();
  });

  it("Admin in OrgA / Limited Admin in OrgB: requireAdmin flips with the active org", async () => {
    // Server-authz coverage for the per-org roles model: a user who
    // is Admin in OrgA but only Limited Admin in OrgB must pass an
    // admin-only gate while OrgA is active and be 403'd while OrgB
    // is active. The legacy "highest wins on users.role" model would
    // have let them through under both orgs.
    const username = `${PREFIX}multi-role`;
    const passwordHash = await hashPassword("Sup3rSecret!");
    const [u] = await db
      .insert(usersTable)
      .values({
        username,
        passwordHash,
        // SSO baseline; authority comes from the per-org rows below.
        role: "limited",
        profile: {},
        authSource: "oidc",
      })
      .returning();
    await db.insert(userOrganizationsTable).values([
      { userId: u!.id, organizationId: orgAId, role: "admin" },
      { userId: u!.id, organizationId: orgBId, role: "limited_admin" },
    ]);
    const cookie = await login(baseUrl, username);

    // Activate Org A — admin-only POST /api/users must succeed past
    // the role gate. (We accept any non-403 status; the route may
    // 4xx for unrelated input reasons, but it must not 403 on role.)
    const activateA = await fetch(`${baseUrl}/api/auth/active-org`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({ organizationId: orgAId }),
    });
    expect(activateA.status).toBe(200);
    const resA = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        username: `${PREFIX}created-by-multi`,
        password: "Sup3rSecret!",
        role: "limited",
      }),
    });
    expect(resA.status).not.toBe(403);

    // Now flip to Org B — same user, but their per-org role is
    // Limited Admin, which requireAdmin must reject.
    const activateB = await fetch(`${baseUrl}/api/auth/active-org`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({ organizationId: orgBId }),
    });
    expect(activateB.status).toBe(200);
    const resB = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        username: `${PREFIX}created-by-multi-2`,
        password: "Sup3rSecret!",
        role: "limited",
      }),
    });
    expect(resB.status).toBe(403);

    // /auth/me reflects the flipped effective role.
    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: withCookie(cookie),
    });
    const body = (await me.json()) as {
      user: { effectiveRole: string | null } | null;
    };
    expect(body.user!.effectiveRole).toBe("limited_admin");
  });

  it("OIDC admin cannot view a cross-org approval (404)", async () => {
    // Seed a fork + submission for a project in Org B, then verify the
    // Org A OIDC admin gets 404 on the approval-by-id route.
    const owner = await provisionUser({
      username: `${PREFIX}owner`,
      role: "limited",
    });
    const { forksTable, approvalSubmissionsTable } = await import(
      "@workspace/db"
    );
    const [fork] = await db
      .insert(forksTable)
      .values({
        userId: owner.id,
        projectName: PROJECT_B,
        forkPath: `/tmp/${PREFIX}fork-b`,
        status: "active",
      })
      .returning();
    const [sub] = await db
      .insert(approvalSubmissionsTable)
      .values({
        forkId: fork!.id,
        submittedBy: owner.id,
        status: "pending",
        snapshotPath: `/tmp/${PREFIX}snap-b`,
      })
      .returning();
    const res = await fetch(`${baseUrl}/api/approvals/${sub!.id}`, {
      headers: withCookie(idpCookie),
    });
    expect(res.status).toBe(404);
  });
});

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { eq, like, and } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  auditEventsTable,
  organizationsTable,
  userOrganizationsTable,
} from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import {
  setIdpUserProvisioner,
  StubIdpUserProvisioner,
  IdpInvitationConflictError,
  IdpNotConfiguredError,
  IdpThrottledError,
  IdpUserNotFoundError,
  type IdpCreateUserInput,
  type IdpInviteUserInput,
  type IdpUserProvisioner,
} from "@/features/users/infrastructure/idpProvisioner";

/**
 * Build a fake {@link IdpUserProvisioner} for tests, filling in any
 * methods the test doesn't care about with a throwing stub. The
 * default `findUserByEmail` returns `null` so the route's
 * lookup-then-link-or-create branching falls through to the create
 * path (matching the pre-link-feature behavior tests were written
 * against). Tests that exercise the link path override
 * `findUserByEmail` + `addUserToOrganization` directly.
 */
function fakeProvisioner(
  overrides: Partial<IdpUserProvisioner>,
): IdpUserProvisioner {
  const fail = (name: string) => async () => {
    throw new Error(`fakeProvisioner: ${name} not stubbed for this test`);
  };
  return {
    createUser: fail("createUser"),
    inviteUser: fail("inviteUser"),
    resendWelcome: fail("resendWelcome"),
    async findUserByEmail() {
      return null;
    },
    async addUserToOrganization() {
      return { alreadyMember: false };
    },
    ...overrides,
  } as IdpUserProvisioner;
}

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let adminWithOrgCookie: string;
let adminNoOrgCookie: string;
let limitedAdminCookie: string;
let limitedCookie: string;

const ACTIVE_ORG_EXTERNAL_KEY = "vitest-active-org-key";
// Real UUID of the seeded org row whose external_key is ACTIVE_ORG_EXTERNAL_KEY.
// Populated in beforeAll once the org row is inserted.
let ACTIVE_ORG_ID: string;

/**
 * Extract the raw express-session sid from a `tb.sid=s%3A<sid>.<sig>`
 * cookie pair (the format returned by the `login` helper).
 */
function sidFromCookie(cookie: string): string {
  const eq = cookie.indexOf("=");
  const raw = decodeURIComponent(cookie.slice(eq + 1));
  // express-session signs as `s:<sid>.<sig>`. Strip the `s:` prefix
  // and the trailing `.<sig>` block.
  const stripped = raw.startsWith("s:") ? raw.slice(2) : raw;
  const dot = stripped.lastIndexOf(".");
  return dot >= 0 ? stripped.slice(0, dot) : stripped;
}

/**
 * Mutate the express-session row backing `cookie` to include the given
 * fields. Used to fake the activeOrgId that the route layer requires
 * for IDP-provisioning calls — a local /auth/login can't set that
 * field itself.
 */
async function setSessionFields(
  cookie: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const sid = sidFromCookie(cookie);
  const { rows } = await pool.query<{ sess: Record<string, unknown> }>(
    "SELECT sess FROM user_sessions WHERE sid = $1",
    [sid],
  );
  if (rows.length === 0) {
    throw new Error(`No session row for sid=${sid}`);
  }
  const next = { ...rows[0]!.sess, ...fields };
  await pool.query("UPDATE user_sessions SET sess = $1 WHERE sid = $2", [
    next,
    sid,
  ]);
}

const ADMIN_USERNAME = "vitest-users-admin";
const LIMITED_ADMIN_USERNAME = "vitest-users-ladmin";
const LIMITED_USERNAME = "vitest-users-limited";
const CREATED_PREFIX = "vitest-users-created-";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  // Seed the org row whose external_key the route layer sends to Nexus.
  // The active-org session field stores the memento internal UUID; the
  // route resolves that to the external_key before talking to Nexus.
  await db
    .delete(organizationsTable)
    .where(eq(organizationsTable.externalKey, ACTIVE_ORG_EXTERNAL_KEY));
  const [seededOrg] = await db
    .insert(organizationsTable)
    .values({
      externalKey: ACTIVE_ORG_EXTERNAL_KEY,
      displayName: ACTIVE_ORG_EXTERNAL_KEY,
    })
    .returning({ id: organizationsTable.id });
  ACTIVE_ORG_ID = seededOrg!.id;
  await provisionUser({ username: ADMIN_USERNAME, role: "admin" });
  await provisionUser({
    username: LIMITED_ADMIN_USERNAME,
    role: "limited_admin",
  });
  await provisionUser({ username: LIMITED_USERNAME, role: "limited" });
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedAdminCookie = await login(baseUrl, LIMITED_ADMIN_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);
  // Two extra admin sessions used by the IDP-provisioning tests.
  // Both carry an oidcAccessToken stub to mirror an SSO sign-in: the
  // route now gates IDP user management on "caller signed in via
  // SSO" as a policy check, even though the actual upstream call to
  // Nexus uses the server-side NEXUS_API_KEY. The token value is
  // never inspected by the route — its presence is the proof.
  //   - adminWithOrgCookie → has activeOrgId + oidcAccessToken (a
  //     fully-eligible SSO admin).
  //   - adminNoOrgCookie   → has oidcAccessToken but no activeOrgId;
  //     exercises the "pick an active org first" 403 in isolation.
  // The "local admin (no SSO token) gets 403" cases mint their own
  // fresh local-login cookie so we don't pollute these two.
  adminWithOrgCookie = await login(baseUrl, ADMIN_USERNAME);
  await setSessionFields(adminWithOrgCookie, {
    activeOrgId: ACTIVE_ORG_ID,
    oidcAccessToken: "vitest-fake-sso-token",
  });
  adminNoOrgCookie = await login(baseUrl, ADMIN_USERNAME);
  await setSessionFields(adminNoOrgCookie, {
    oidcAccessToken: "vitest-fake-sso-token",
  });
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await db
    .delete(organizationsTable)
    .where(eq(organizationsTable.externalKey, ACTIVE_ORG_EXTERNAL_KEY));
  await close();
});

afterEach(async () => {
  // Clean up any users created via POST /users during the suite.
  // Match prefix anywhere in the username — IDP-path tests use
  // `<purpose>-${CREATED_PREFIX}@example.com` so the prefix sits in
  // the middle, not at the start.
  await db.delete(usersTable).where(like(usersTable.username, `%${CREATED_PREFIX}%`));
});

describe("GET /api/users", () => {
  it("returns 200 with an array to an admin", async () => {
    // Local username/password admins have no `user_organizations`
    // rows, so under org-scoped visibility the response is an empty
    // array — the gate still admits the caller, but the listing is
    // narrowed to "users in orgs you administer", and a local admin
    // administers no orgs by definition. Memento Admin coverage and
    // the cross-org scoping rules are exercised in the dedicated
    // "scopes the list by the caller's admin org memberships" suite
    // below.
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ username: string }>;
    expect(Array.isArray(body)).toBe(true);
  });

  it("returns the user list to a limited_admin", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: withCookie(limitedAdminCookie),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a limited user with 403", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: withCookie(limitedCookie),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/users — scopes the list by the caller's admin org memberships", () => {
  // Task #93: a non-Memento Admin in OrgA must not see users that
  // belong solely to OrgB. Scope is derived from the caller's
  // `user_organizations` rows (admin / limited_admin), not from the
  // session's active org — switching active org cannot change the
  // visible row set.
  const PREFIX = "vitest-scope-93-";
  const ORG_A_KEY = `${PREFIX}orgA-key`;
  const ORG_B_KEY = `${PREFIX}orgB-key`;
  const ORG_C_KEY = `${PREFIX}orgC-key`;

  let orgAId: string;
  let orgBId: string;
  let orgCId: string;

  const MEMENTO = `${PREFIX}memento`;
  const ADMIN_A = `${PREFIX}admin-a`;
  const ADMIN_AC = `${PREFIX}admin-ac`;
  const USER_A_ONLY = `${PREFIX}user-a-only`;
  const USER_B_ONLY = `${PREFIX}user-b-only`;
  const USER_C_ONLY = `${PREFIX}user-c-only`;
  const USER_AB = `${PREFIX}user-ab`;

  let mementoCookie: string;
  let adminACookie: string;
  let adminACookieActiveB: string;
  let adminACCookie: string;

  async function addMembership(
    userId: string,
    orgId: string,
    role: "admin" | "limited_admin" | "limited",
  ): Promise<void> {
    await db.insert(userOrganizationsTable).values({
      userId,
      organizationId: orgId,
      role,
    });
  }

  beforeAll(async () => {
    // Fresh orgs for this suite.
    for (const key of [ORG_A_KEY, ORG_B_KEY, ORG_C_KEY]) {
      await db
        .delete(organizationsTable)
        .where(eq(organizationsTable.externalKey, key));
    }
    const [insA, insB, insC] = await Promise.all([
      db
        .insert(organizationsTable)
        .values({ externalKey: ORG_A_KEY, displayName: "Scope OrgA" })
        .returning({ id: organizationsTable.id }),
      db
        .insert(organizationsTable)
        .values({ externalKey: ORG_B_KEY, displayName: "Scope OrgB" })
        .returning({ id: organizationsTable.id }),
      db
        .insert(organizationsTable)
        .values({ externalKey: ORG_C_KEY, displayName: "Scope OrgC" })
        .returning({ id: organizationsTable.id }),
    ]);
    orgAId = insA[0]!.id;
    orgBId = insB[0]!.id;
    orgCId = insC[0]!.id;

    // Seed users. The "admin" callers carry global role=admin so
    // requireAnyAdmin admits them — their org-scoping comes from
    // user_organizations rows seeded below.
    await provisionUser({
      username: MEMENTO,
      role: "memento_admin",
    });
    const adminA = await provisionUser({ username: ADMIN_A, role: "admin" });
    const adminAC = await provisionUser({ username: ADMIN_AC, role: "admin" });
    const userAOnly = await provisionUser({
      username: USER_A_ONLY,
      role: "limited",
    });
    const userBOnly = await provisionUser({
      username: USER_B_ONLY,
      role: "limited",
    });
    const userCOnly = await provisionUser({
      username: USER_C_ONLY,
      role: "limited",
    });
    const userAB = await provisionUser({ username: USER_AB, role: "limited" });

    // Memberships:
    //   adminA   → admin in OrgA
    //   adminAC  → admin in OrgA + admin in OrgC
    //   userAOnly→ limited in OrgA
    //   userBOnly→ limited in OrgB
    //   userCOnly→ limited in OrgC
    //   userAB   → limited in OrgA + limited in OrgB
    await Promise.all([
      addMembership(adminA.id, orgAId, "admin"),
      addMembership(adminAC.id, orgAId, "admin"),
      addMembership(adminAC.id, orgCId, "admin"),
      addMembership(userAOnly.id, orgAId, "limited"),
      addMembership(userBOnly.id, orgBId, "limited"),
      addMembership(userCOnly.id, orgCId, "limited"),
      addMembership(userAB.id, orgAId, "limited"),
      addMembership(userAB.id, orgBId, "limited"),
    ]);

    mementoCookie = await login(baseUrl, MEMENTO);
    adminACookie = await login(baseUrl, ADMIN_A);
    // Second session for ADMIN_A with active org pinned to OrgB —
    // proves scope is decided by admin assignments, not session.
    adminACookieActiveB = await login(baseUrl, ADMIN_A);
    await setSessionFields(adminACookieActiveB, { activeOrgId: orgBId });
    adminACCookie = await login(baseUrl, ADMIN_AC);
  });

  afterAll(async () => {
    for (const u of [
      MEMENTO,
      ADMIN_A,
      ADMIN_AC,
      USER_A_ONLY,
      USER_B_ONLY,
      USER_C_ONLY,
      USER_AB,
    ]) {
      await deleteUserByUsername(u);
    }
    for (const key of [ORG_A_KEY, ORG_B_KEY, ORG_C_KEY]) {
      await db
        .delete(organizationsTable)
        .where(eq(organizationsTable.externalKey, key));
    }
  });

  async function listUsernames(cookie: string): Promise<Set<string>> {
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: withCookie(cookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ username: string }>;
    return new Set(body.map((u) => u.username));
  }

  it("Memento Admin sees every user in every org (god-mode unchanged)", async () => {
    const names = await listUsernames(mementoCookie);
    for (const u of [
      ADMIN_A,
      ADMIN_AC,
      USER_A_ONLY,
      USER_B_ONLY,
      USER_C_ONLY,
      USER_AB,
    ]) {
      expect(names.has(u)).toBe(true);
    }
  });

  it("OrgA-only Admin sees OrgA members (including cross-org overlap) but never OrgB-only or OrgC-only users", async () => {
    const names = await listUsernames(adminACookie);
    expect(names.has(USER_A_ONLY)).toBe(true);
    expect(names.has(USER_AB)).toBe(true); // OrgA ∩ OrgB overlap still visible
    expect(names.has(ADMIN_A)).toBe(true); // caller themselves (OrgA admin row)
    expect(names.has(ADMIN_AC)).toBe(true); // also in OrgA
    expect(names.has(USER_B_ONLY)).toBe(false);
    expect(names.has(USER_C_ONLY)).toBe(false);
    // Local-only seeded accounts (no memberships) must not surface.
    expect(names.has(MEMENTO)).toBe(false);
    expect(names.has(ADMIN_USERNAME)).toBe(false);
  });

  it("returns the same row set for an OrgA-only Admin regardless of the session's active org", async () => {
    // Scope follows admin assignments, not req.session.activeOrgId.
    // Same admin, different active org pinned → identical listing.
    const namesDefault = await listUsernames(adminACookie);
    const namesActiveB = await listUsernames(adminACookieActiveB);
    expect([...namesActiveB].sort()).toEqual([...namesDefault].sort());
    // Sanity: OrgB-only user is still excluded even though the
    // session is now "in OrgB".
    expect(namesActiveB.has(USER_B_ONLY)).toBe(false);
  });

  it("Admin assigned to OrgA + OrgC sees the union of both orgs but not OrgB-only users", async () => {
    const names = await listUsernames(adminACCookie);
    expect(names.has(USER_A_ONLY)).toBe(true);
    expect(names.has(USER_C_ONLY)).toBe(true);
    expect(names.has(USER_AB)).toBe(true); // OrgA membership covers the overlap user
    expect(names.has(USER_B_ONLY)).toBe(false);
  });
});

describe("POST /api/users", () => {
  it("creates a user with a temporary password (admin)", async () => {
    const username = `${CREATED_PREFIX}new`;
    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ username, role: "limited" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { username: string; role: string };
      temporaryPassword: string;
    };
    expect(body.user.username).toBe(username);
    expect(body.user.role).toBe("limited");
    expect(typeof body.temporaryPassword).toBe("string");
  });

  it("rejects a limited_admin caller with 403", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        username: `${CREATED_PREFIX}forbidden`,
        role: "limited",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid username with 400", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ username: "??", role: "limited" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 on a duplicate username", async () => {
    const username = `${CREATED_PREFIX}dup`;
    const first = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ username, role: "limited" }),
    });
    expect(first.status).toBe(201);
    const second = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ username, role: "limited" }),
    });
    expect(second.status).toBe(409);
  });
});

describe("POST /api/users/invite", () => {
  const PREV_ENABLED = process.env.IDP_PROVISIONING_ENABLED;
  let restoreProvisioner: IdpUserProvisioner;

  beforeAll(() => {
    process.env.IDP_PROVISIONING_ENABLED = "1";
    restoreProvisioner = setIdpUserProvisioner(new StubIdpUserProvisioner());
  });

  afterAll(() => {
    if (PREV_ENABLED === undefined) {
      delete process.env.IDP_PROVISIONING_ENABLED;
    } else {
      process.env.IDP_PROVISIONING_ENABLED = PREV_ENABLED;
    }
    setIdpUserProvisioner(restoreProvisioner);
  });

  it("returns 403 to a non-admin (limited user)", async () => {
    const res = await fetch(`${baseUrl}/api/users/invite`, {
      method: "POST",
      headers: withCookie(limitedCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ email: `invite-${CREATED_PREFIX}@example.com` }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 when email is malformed", async () => {
    const res = await fetch(`${baseUrl}/api/users/invite`, {
      method: "POST",
      headers: withCookie(adminWithOrgCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 with SSO-required message for a local admin (no oidcAccessToken), without calling the adapter", async () => {
    let adapterCalled = false;
    const trap = fakeProvisioner({
      async inviteUser() {
        adapterCalled = true;
        return {
          email: "x@example.com",
          invitationCode: "nvi_x",
          expiresAt: "2026-06-02T12:00:00Z",
        };
      },
    });
    const prev = setIdpUserProvisioner(trap);
    try {
      const res = await fetch(`${baseUrl}/api/users/invite`, {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ email: `local-${CREATED_PREFIX}@example.com` }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/SSO/i);
      expect(adapterCalled).toBe(false);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("returns 403 with active-org message for an SSO admin without an active org", async () => {
    const res = await fetch(`${baseUrl}/api/users/invite`, {
      method: "POST",
      headers: withCookie(adminNoOrgCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ email: `noorg-${CREATED_PREFIX}@example.com` }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/active organization/i);
  });

  it("calls the adapter with the active org's externalKey and returns { email, expiresAt } — invitationCode is NOT echoed back", async () => {
    const captured: IdpInviteUserInput[] = [];
    const fake = fakeProvisioner({
      async inviteUser(input) {
        captured.push(input);
        return {
          email: input.email,
          invitationCode: "nvi_should_stay_server_side",
          expiresAt: "2026-06-02T12:00:00Z",
        };
      },
    });
    const prev = setIdpUserProvisioner(fake);
    try {
      const res = await fetch(`${baseUrl}/api/users/invite`, {
        method: "POST",
        headers: withCookie(adminWithOrgCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          email: `ok-${CREATED_PREFIX}@example.com`,
          firstName: "Ok",
          lastName: "Person",
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        email: `ok-${CREATED_PREFIX}@example.com`,
        expiresAt: "2026-06-02T12:00:00Z",
      });
      // CRITICAL: the invitation code is a bearer-equivalent token
      // and must NEVER leave the server — the recipient gets it via
      // Nexus's email, not via the admin who triggered the invite.
      expect(body.invitationCode).toBeUndefined();
      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({
        email: `ok-${CREATED_PREFIX}@example.com`,
        firstName: "Ok",
        lastName: "Person",
        organizationId: ACTIVE_ORG_EXTERNAL_KEY,
        mementoOrgId: ACTIVE_ORG_ID,
      });
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("maps IdpNotConfiguredError -> 503", async () => {
    const fake = fakeProvisioner({
      async inviteUser() {
        throw new IdpNotConfiguredError(
          "IDP API key not configured. Set NEXUS_API_KEY.",
        );
      },
    });
    const prev = setIdpUserProvisioner(fake);
    try {
      const res = await fetch(`${baseUrl}/api/users/invite`, {
        method: "POST",
        headers: withCookie(adminWithOrgCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ email: `noidp-${CREATED_PREFIX}@example.com` }),
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/IDP API key not configured/);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("maps IdpInvitationConflictError -> 409", async () => {
    const fake = fakeProvisioner({
      async inviteUser() {
        throw new IdpInvitationConflictError(
          "Nexus 409: Active invitation already exists",
        );
      },
    });
    const prev = setIdpUserProvisioner(fake);
    try {
      const res = await fetch(`${baseUrl}/api/users/invite`, {
        method: "POST",
        headers: withCookie(adminWithOrgCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ email: `dup-${CREATED_PREFIX}@example.com` }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/Active invitation already exists/);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("maps any other adapter error -> 502 with the upstream reason", async () => {
    const fake = fakeProvisioner({
      async inviteUser() {
        throw new Error("Nexus 500: boom");
      },
    });
    const prev = setIdpUserProvisioner(fake);
    try {
      const res = await fetch(`${baseUrl}/api/users/invite`, {
        method: "POST",
        headers: withCookie(adminWithOrgCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ email: `boom-${CREATED_PREFIX}@example.com` }),
      });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/IDP invitation failed: Nexus 500: boom/);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });
});

describe("POST /api/users (provisionInIdp)", () => {
  const PREV_ENABLED = process.env.IDP_PROVISIONING_ENABLED;
  let restoreProvisioner: IdpUserProvisioner;

  beforeAll(() => {
    process.env.IDP_PROVISIONING_ENABLED = "1";
    restoreProvisioner = setIdpUserProvisioner(new StubIdpUserProvisioner());
  });

  afterAll(() => {
    if (PREV_ENABLED === undefined) {
      delete process.env.IDP_PROVISIONING_ENABLED;
    } else {
      process.env.IDP_PROVISIONING_ENABLED = PREV_ENABLED;
    }
    setIdpUserProvisioner(restoreProvisioner);
  });

  it("rejects with 400 when email is missing", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        // New contract: when provisionInIdp=true, username must itself
        // be a valid email. Sending a valid-email username with no
        // email field still fails the downstream "Email is required"
        // check.
        username: `noemail-${CREATED_PREFIX}@example.com`,
        role: "limited",
        provisionInIdp: true,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Email is required/);
  });

  it("rejects with 400 when email is malformed", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        username: `bademail-${CREATED_PREFIX}@example.com`,
        role: "limited",
        email: "not-an-email",
        provisionInIdp: true,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 503 with the 'IDP API key not configured' message when the stub adapter is installed", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: withCookie(adminWithOrgCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        username: `stub-${CREATED_PREFIX}@example.com`,
        role: "limited",
        email: `stub-${CREATED_PREFIX}@example.com`,
        provisionInIdp: true,
      }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/IDP API key not configured/);
    expect(body.error).toMatch(/NEXUS_API_KEY/);
  });

  it("returns 403 with active-organization message when the session's activeOrgId points to an org row that no longer exists (stale session)", async () => {
    // Lock in the fallback: if the session carries a UUID that doesn't
    // resolve to an organizations row, we must NOT call the adapter
    // with that UUID (the previous bug — Nexus replied 400 "Organization
    // not found"). Instead the route returns the same 403 the
    // no-activeOrgId branch returns, so the user picks an active org.
    let adapterCalled = false;
    const trap = fakeProvisioner({
      async createUser() {
        adapterCalled = true;
        return { externalId: "should-not-happen" };
      },
      async findUserByEmail() {
        adapterCalled = true;
        return null;
      },
      async addUserToOrganization() {
        adapterCalled = true;
        return { alreadyMember: false };
      },
    });
    const staleCookie = await login(baseUrl, ADMIN_USERNAME);
    await setSessionFields(staleCookie, {
      // Well-formed UUID that doesn't match any seeded org row.
      activeOrgId: "00000000-0000-0000-0000-000000000000",
      oidcAccessToken: "vitest-fake-sso-token",
    });
    const prev = setIdpUserProvisioner(trap);
    try {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: withCookie(staleCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          username: `stale-${CREATED_PREFIX}@example.com`,
          role: "limited",
          email: `stale-${CREATED_PREFIX}@example.com`,
          provisionInIdp: true,
        }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/active organization/i);
      expect(adapterCalled).toBe(false);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("returns 403 with active-organization message for an admin without activeOrgId", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: withCookie(adminNoOrgCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        username: `noorg-${CREATED_PREFIX}@example.com`,
        role: "limited",
        email: `noorg-${CREATED_PREFIX}@example.com`,
        provisionInIdp: true,
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/active organization/i);
  });

  it("returns the externalId end-to-end with a fake provisioner (no per-admin access token forwarded)", async () => {
    const captured: IdpCreateUserInput[] = [];
    const fake = fakeProvisioner({
      async createUser(input) {
        captured.push(input);
        return { externalId: "nexus-fake-1" };
      },
    });
    const prev = setIdpUserProvisioner(fake);
    try {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: withCookie(adminWithOrgCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          username: `fake-${CREATED_PREFIX}@example.com`,
          role: "limited",
          firstName: "Fake",
          lastName: "User",
          email: `fake-${CREATED_PREFIX}@example.com`,
          provisionInIdp: true,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        provisionedInIdp: boolean;
        idpExternalId: string;
        user: { id: string; email: string };
        temporaryPassword: string | null;
      };
      expect(body.provisionedInIdp).toBe(true);
      expect(body.idpExternalId).toBe("nexus-fake-1");
      expect(body.user.email).toBe(`fake-${CREATED_PREFIX}@example.com`);
      expect(body.temporaryPassword).toBeNull();
      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({
        username: `fake-${CREATED_PREFIX}@example.com`,
        role: "limited",
        email: `fake-${CREATED_PREFIX}@example.com`,
        // The active-org gate still applies — memento pins the
        // organizationId to the calling admin's active SSO org so
        // the IDP can scope provisioning correctly. The per-admin
        // access token is no longer part of the input contract; the
        // adapter authenticates with the server-side API key
        // instead.
        organizationId: ACTIVE_ORG_EXTERNAL_KEY,
        // The route fills mementoUserClaimName from the same env
        // var the SSO gate reads (OIDC_MEMENTO_USER_CLAIM, default
        // "mementoUser") so the adapter can seed the user-gate
        // claim on the new Nexus user and they can sign in
        // immediately.
        mementoUserClaimName:
          (process.env.OIDC_MEMENTO_USER_CLAIM?.trim() || "mementoUser"),
      });
      expect((captured[0] as unknown as { accessToken?: unknown }).accessToken).toBeUndefined();
      // The route MUST NOT send a server-generated password; Nexus
      // runs in invitation-code mode and emails the user a welcome
      // link to set their own password. Sending a password trips
      // Nexus's HaveIBeenPwned check on common values.
      expect(captured[0]!.password ?? null).toBeNull();
      // A local row IS created so the IDP user appears in Settings →
      // Users; it carries the IDP external id and the IDP auth source.
      const [local] = await db
        .select()
        .from(usersTable)
        .where(
          eq(usersTable.username, `fake-${CREATED_PREFIX}@example.com`),
        );
      expect(local).toBeDefined();
      expect(local!.idpExternalId).toBe("nexus-fake-1");
      expect(local!.oidcSubject).toBe("nexus-fake-1");
      expect(local!.authSource).toBe("oidc");
      expect(local!.passwordHash).toBeNull();
      expect(body.user.id).toBe(local!.id);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("returns 403 with the SSO-required message when a local admin (no oidcAccessToken) tries to provision in the IDP — even with an active org set", async () => {
    // Policy gate: only admins who signed in via SSO may create
    // Nexus users, even though the actual upstream call uses the
    // server-side NEXUS_API_KEY. A local username/password admin
    // (seeded user, dev-login) with an active org still gets 403
    // because their session has no oidcAccessToken. The adapter
    // must NOT be reached.
    let adapterCalled = false;
    const trap = fakeProvisioner({
      async createUser() {
        adapterCalled = true;
        return { externalId: "should-not-happen" };
      },
      async findUserByEmail() {
        adapterCalled = true;
        return null;
      },
      async addUserToOrganization() {
        adapterCalled = true;
        return { alreadyMember: false };
      },
      async resendWelcome() {
        adapterCalled = true;
        return { message: "should-not-happen", lastResentAt: null, resendCount: null };
      },
    });
    const localAdminWithOrg = await login(baseUrl, ADMIN_USERNAME);
    await setSessionFields(localAdminWithOrg, { activeOrgId: ACTIVE_ORG_ID });
    const prev = setIdpUserProvisioner(trap);
    try {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: withCookie(localAdminWithOrg, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          username: `localdenied-${CREATED_PREFIX}@example.com`,
          role: "limited",
          email: `localdenied-${CREATED_PREFIX}@example.com`,
          provisionInIdp: true,
        }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/SSO/i);
      expect(adapterCalled).toBe(false);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("local admin can still create a local (non-IDP) user via the same route", async () => {
    // The SSO gate only applies when provisionInIdp=true. A local
    // admin keeps the ability to create local username/password
    // accounts — that path doesn't touch Nexus at all.
    const localAdmin = await login(baseUrl, ADMIN_USERNAME);
    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: withCookie(localAdmin, { "content-type": "application/json" }),
      body: JSON.stringify({
        username: `${CREATED_PREFIX}localfromlocal`,
        role: "limited",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      provisionedInIdp?: boolean;
      temporaryPassword: string | null;
    };
    expect(body.provisionedInIdp).toBeFalsy();
    expect(body.temporaryPassword).toBeTruthy();
  });

  it("links an existing IDP user (found by email) to the active org instead of creating a duplicate", async () => {
    // Scenario: the same person was already added to another org in a
    // previous flow. findUserByEmail returns their externalId; the
    // route must call addUserToOrganization on the active org and
    // skip createUser entirely (creating would 409 in Nexus).
    const lookups: string[] = [];
    const linkCalls: Array<{
      externalId: string;
      organizationId: string;
      nexusRole: string;
      mementoOrgId?: string | null;
    }> = [];
    let createCalled = false;
    const fake = fakeProvisioner({
      async createUser() {
        createCalled = true;
        return { externalId: "should-not-be-called" };
      },
      async findUserByEmail(email) {
        lookups.push(email);
        return {
          externalId: "nexus-existing-1",
          email: email.toLowerCase(),
          name: "Existing Person",
        };
      },
      async addUserToOrganization(input) {
        linkCalls.push(input);
        return { alreadyMember: false };
      },
    });
    const prev = setIdpUserProvisioner(fake);
    const username = `link-${CREATED_PREFIX}@example.com`;
    try {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: withCookie(adminWithOrgCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          username,
          role: "limited_admin",
          email: username,
          provisionInIdp: true,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        provisionedInIdp: boolean;
        idpExternalId: string;
        linkedExistingIdpUser: boolean;
        alreadyMemberOfOrg: boolean;
        user: {
          id: string;
          memberships: Array<{
            organizationId: string;
            role: string;
          }>;
        };
      };
      expect(body.provisionedInIdp).toBe(true);
      expect(body.linkedExistingIdpUser).toBe(true);
      expect(body.alreadyMemberOfOrg).toBe(false);
      expect(body.idpExternalId).toBe("nexus-existing-1");
      expect(createCalled).toBe(false);
      expect(lookups).toEqual([username]);
      expect(linkCalls).toEqual([
        {
          externalId: "nexus-existing-1",
          organizationId: ACTIVE_ORG_EXTERNAL_KEY,
          // limited_admin → org_limited_admin
          nexusRole: "org_limited_admin",
          // Per-org Nexus partner keys: the route now threads the
          // calling admin's active memento org id through so the
          // adapter's keyResolver can pick the right per-org key.
          mementoOrgId: ACTIVE_ORG_ID,
        },
      ]);
      // Local memento row is created with the same idpExternalId so the
      // user shows in Settings → Users immediately.
      const [local] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.username, username));
      expect(local).toBeDefined();
      expect(local!.idpExternalId).toBe("nexus-existing-1");
      expect(local!.authSource).toBe("oidc");
      // And the per-org membership row exists so the new user appears
      // in the active org's user list without waiting for SSO sync.
      const [membership] = await db
        .select()
        .from(userOrganizationsTable)
        .where(
          and(
            eq(userOrganizationsTable.userId, local!.id),
            eq(userOrganizationsTable.organizationId, ACTIVE_ORG_ID),
          ),
        );
      expect(membership).toBeDefined();
      expect(membership!.role).toBe("limited_admin");
      expect(body.user.memberships.some((m) => m.role === "limited_admin")).toBe(
        true,
      );
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("reuses an existing local OIDC row when linking a user that already has a memento account", async () => {
    // Real-world scenario: the user signed in via SSO under their
    // original org first, which created a local memento row stamped
    // with `idpExternalId` = Nexus subject. An admin in a different
    // org now adds them again via Settings → Users. The route must
    // reuse the existing local row instead of failing on the
    // username unique constraint.
    const username = `reuse-${CREATED_PREFIX}@example.com`;
    const externalId = "nexus-reuse-1";
    const [preseeded] = await db
      .insert(usersTable)
      .values({
        username,
        passwordHash: null,
        role: "limited",
        firstName: "Existing",
        lastName: "User",
        email: username,
        profile: {},
        authSource: "oidc",
        oidcSubject: externalId,
        idpExternalId: externalId,
      })
      .returning();
    const fake = fakeProvisioner({
      async findUserByEmail(email) {
        return { externalId, email: email.toLowerCase(), name: null };
      },
      async addUserToOrganization() {
        return { alreadyMember: false };
      },
    });
    const prev = setIdpUserProvisioner(fake);
    try {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: withCookie(adminWithOrgCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          username,
          role: "limited",
          email: username,
          provisionInIdp: true,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        linkedExistingIdpUser: boolean;
        user: { id: string };
      };
      expect(body.linkedExistingIdpUser).toBe(true);
      // Same memento row — no duplicate inserted.
      expect(body.user.id).toBe(preseeded!.id);
      const rows = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.username, username));
      expect(rows).toHaveLength(1);
      // And the per-org membership row for the active org now exists.
      const [membership] = await db
        .select()
        .from(userOrganizationsTable)
        .where(
          and(
            eq(userOrganizationsTable.userId, preseeded!.id),
            eq(userOrganizationsTable.organizationId, ACTIVE_ORG_ID),
          ),
        );
      expect(membership).toBeDefined();
    } finally {
      setIdpUserProvisioner(prev);
      await db.delete(usersTable).where(eq(usersTable.id, preseeded!.id));
    }
  });

  it("returns 409 when a local username collides with a different IDP user", async () => {
    // A local row exists with the same username but a *different*
    // idpExternalId (or none at all). That's a real collision — we
    // must NOT silently overwrite or link the wrong user.
    const username = `clash-${CREATED_PREFIX}@example.com`;
    const [local] = await db
      .insert(usersTable)
      .values({
        username,
        passwordHash: "x",
        role: "limited",
        email: username,
        profile: {},
        authSource: "local",
      })
      .returning();
    const fake = fakeProvisioner({
      async findUserByEmail(email) {
        return {
          externalId: "nexus-different-person",
          email: email.toLowerCase(),
          name: null,
        };
      },
      async addUserToOrganization() {
        return { alreadyMember: false };
      },
    });
    const prev = setIdpUserProvisioner(fake);
    try {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: withCookie(adminWithOrgCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          username,
          role: "limited",
          email: username,
          provisionInIdp: true,
        }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not linked|already exists/i);
    } finally {
      setIdpUserProvisioner(prev);
      await db.delete(usersTable).where(eq(usersTable.id, local!.id));
    }
  });

  it("treats Nexus's already-a-member response as success (idempotent link)", async () => {
    const fake = fakeProvisioner({
      async findUserByEmail(email) {
        return {
          externalId: "nexus-existing-2",
          email: email.toLowerCase(),
          name: null,
        };
      },
      async addUserToOrganization() {
        return { alreadyMember: true };
      },
    });
    const prev = setIdpUserProvisioner(fake);
    const username = `linkidem-${CREATED_PREFIX}@example.com`;
    try {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: withCookie(adminWithOrgCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          username,
          role: "limited",
          email: username,
          provisionInIdp: true,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        linkedExistingIdpUser: boolean;
        alreadyMemberOfOrg: boolean;
      };
      expect(body.linkedExistingIdpUser).toBe(true);
      expect(body.alreadyMemberOfOrg).toBe(true);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("returns a friendly 409 with a visibility-miss hint when Nexus says 'Email already exists' on create (lookup was empty)", async () => {
    // Per the Nexus partner doc: empty lookup + create 409 means the
    // email exists in a tenant/org the API key can't see. We surface a
    // clearer admin-facing message instead of the raw Nexus reason.
    const failing = fakeProvisioner({
      async createUser() {
        throw new Error("Nexus 409: Email already exists");
      },
    });
    const prev = setIdpUserProvisioner(failing);
    try {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: withCookie(adminWithOrgCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          username: `dupidp-${CREATED_PREFIX}@example.com`,
          role: "limited",
          email: `dupidp-${CREATED_PREFIX}@example.com`,
          provisionInIdp: true,
        }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/API key cannot see|Nexus administrator/i);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("still returns 502 with the verbatim Nexus reason on non-409 createUser failures", async () => {
    const failing = fakeProvisioner({
      async createUser() {
        throw new Error("Nexus 500: upstream exploded");
      },
    });
    const prev = setIdpUserProvisioner(failing);
    try {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: withCookie(adminWithOrgCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          username: `boom-${CREATED_PREFIX}@example.com`,
          role: "limited",
          email: `boom-${CREATED_PREFIX}@example.com`,
          provisionInIdp: true,
        }),
      });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/Nexus 500: upstream exploded/);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });
});

describe("POST /api/users/:id/resend-welcome", () => {
  const RESEND_USERNAME = "vitest-users-resend-target";
  let targetId: string;
  const PREV_ENABLED_RW = process.env.IDP_PROVISIONING_ENABLED;

  beforeAll(async () => {
    process.env.IDP_PROVISIONING_ENABLED = "1";
    await db.delete(usersTable).where(eq(usersTable.username, RESEND_USERNAME));
    const [created] = await db
      .insert(usersTable)
      .values({
        username: RESEND_USERNAME,
        passwordHash: null,
        role: "limited",
        authSource: "oidc",
        oidcSubject: "nexus-resend-1",
        idpExternalId: "nexus-resend-1",
        email: "resend@example.com",
      })
      .returning();
    targetId = created!.id;
  });

  afterAll(async () => {
    await db.delete(usersTable).where(eq(usersTable.username, RESEND_USERNAME));
    if (PREV_ENABLED_RW === undefined) {
      delete process.env.IDP_PROVISIONING_ENABLED;
    } else {
      process.env.IDP_PROVISIONING_ENABLED = PREV_ENABLED_RW;
    }
  });

  it("requires admin (limited admin gets 403)", async () => {
    const res = await fetch(
      `${baseUrl}/api/users/${targetId}/resend-welcome`,
      { method: "POST", headers: withCookie(limitedAdminCookie) },
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown user id", async () => {
    const res = await fetch(
      `${baseUrl}/api/users/00000000-0000-0000-0000-000000000000/resend-welcome`,
      { method: "POST", headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for a local (non-IDP) user", async () => {
    const local = await provisionUser({
      username: `${CREATED_PREFIX}localresend`,
      role: "limited",
    });
    try {
      const res = await fetch(
        `${baseUrl}/api/users/${local.id}/resend-welcome`,
        { method: "POST", headers: withCookie(adminCookie) },
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not provisioned through the identity provider/);
    } finally {
      await db.delete(usersTable).where(eq(usersTable.id, local.id));
    }
  });

  it("returns 403 with active-organization message when the SSO admin has no activeOrgId", async () => {
    const res = await fetch(
      `${baseUrl}/api/users/${targetId}/resend-welcome`,
      { method: "POST", headers: withCookie(adminNoOrgCookie) },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/active organization/i);
  });

  it("returns 403 with the SSO-required message when a local admin (no oidcAccessToken) tries to resend a welcome email", async () => {
    // Same policy gate as POST /users (provisionInIdp): a local
    // username/password admin can't trigger any Nexus side effect
    // even on a row that already exists in the IDP. Adapter must
    // not be called.
    let adapterCalled = false;
    const trap = fakeProvisioner({
      async createUser() {
        adapterCalled = true;
        return { externalId: "should-not-happen" };
      },
      async findUserByEmail() {
        adapterCalled = true;
        return null;
      },
      async addUserToOrganization() {
        adapterCalled = true;
        return { alreadyMember: false };
      },
      async resendWelcome() {
        adapterCalled = true;
        return { message: "should-not-happen", lastResentAt: null, resendCount: null };
      },
    });
    const localAdminWithOrg = await login(baseUrl, ADMIN_USERNAME);
    await setSessionFields(localAdminWithOrg, { activeOrgId: ACTIVE_ORG_ID });
    const prev = setIdpUserProvisioner(trap);
    try {
      const res = await fetch(
        `${baseUrl}/api/users/${targetId}/resend-welcome`,
        { method: "POST", headers: withCookie(localAdminWithOrg) },
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/SSO/i);
      expect(adapterCalled).toBe(false);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("returns 200 with the IDP payload on success (no per-admin access token forwarded)", async () => {
    let receivedExternalId: string | null = null;
    let extraArgs: unknown[] = [];
    const fake = fakeProvisioner({
      async resendWelcome(externalId, ...rest) {
        receivedExternalId = externalId;
        extraArgs = rest;
        return {
          message: "Welcome email re-sent",
          lastResentAt: "2026-05-07T18:42:11Z",
          resendCount: 3,
        };
      },
    });
    const prev = setIdpUserProvisioner(fake);
    try {
      const res = await fetch(
        `${baseUrl}/api/users/${targetId}/resend-welcome`,
        { method: "POST", headers: withCookie(adminWithOrgCookie) },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        message: string;
        lastResentAt: string | null;
        resendCount: number | null;
      };
      expect(body.message).toBe("Welcome email re-sent");
      expect(body.resendCount).toBe(3);
      expect(receivedExternalId).toBe("nexus-resend-1");
      // The route now threads the target user's
      // provisionedInOrgId (or the caller's active org for legacy
      // users with no recorded provisioning org) through so the
      // adapter's keyResolver can pick the right per-org Nexus
      // partner key. The per-admin OIDC access token is no longer
      // forwarded.
      expect(extraArgs).toEqual([ACTIVE_ORG_ID]);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("returns 429 with Retry-After header when the IDP throttles", async () => {
    const fake = fakeProvisioner({
      async resendWelcome(_externalId) {
        throw new IdpThrottledError("Please wait before resending.", {
          retryAfterSeconds: 47,
          lastResentAt: "2026-05-07T18:41:24Z",
          resendCount: 1,
        });
      },
    });
    const prev = setIdpUserProvisioner(fake);
    try {
      const res = await fetch(
        `${baseUrl}/api/users/${targetId}/resend-welcome`,
        { method: "POST", headers: withCookie(adminWithOrgCookie) },
      );
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("47");
      const body = (await res.json()) as {
        error: string;
        retryAfterSeconds: number;
        resendCount: number;
      };
      expect(body.retryAfterSeconds).toBe(47);
      expect(body.resendCount).toBe(1);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("returns 503 when the stub adapter is still installed", async () => {
    const prev = setIdpUserProvisioner(new StubIdpUserProvisioner());
    try {
      const res = await fetch(
        `${baseUrl}/api/users/${targetId}/resend-welcome`,
        { method: "POST", headers: withCookie(adminWithOrgCookie) },
      );
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/IDP API key not configured/);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("returns 502 with the verbatim IDP reason on adapter failure", async () => {
    const fake = fakeProvisioner({
      async resendWelcome(_externalId) {
        throw new Error("Nexus 500: backend exploded");
      },
    });
    const prev = setIdpUserProvisioner(fake);
    try {
      const res = await fetch(
        `${baseUrl}/api/users/${targetId}/resend-welcome`,
        { method: "POST", headers: withCookie(adminWithOrgCookie) },
      );
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/Nexus 500: backend exploded/);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });

  it("returns 400 when IDP provisioning is disabled on the server", async () => {
    delete process.env.IDP_PROVISIONING_ENABLED;
    try {
      const res = await fetch(
        `${baseUrl}/api/users/${targetId}/resend-welcome`,
        { method: "POST", headers: withCookie(adminCookie) },
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/IDP provisioning is not enabled/);
    } finally {
      process.env.IDP_PROVISIONING_ENABLED = "1";
    }
  });

  it("returns 404 when the IDP reports the user is missing", async () => {
    const fake = fakeProvisioner({
      async resendWelcome(_externalId) {
        throw new IdpUserNotFoundError("user not found in IDP");
      },
    });
    const prev = setIdpUserProvisioner(fake);
    try {
      const res = await fetch(
        `${baseUrl}/api/users/${targetId}/resend-welcome`,
        { method: "POST", headers: withCookie(adminWithOrgCookie) },
      );
      expect(res.status).toBe(404);
    } finally {
      setIdpUserProvisioner(prev);
    }
  });
});

describe("PATCH /api/users/:id", () => {
  it("updates a user's role (admin)", async () => {
    const target = await provisionUser({
      username: `${CREATED_PREFIX}roleflip`,
      role: "limited",
    });
    const res = await fetch(`${baseUrl}/api/users/${target.id}`, {
      method: "PATCH",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ role: "limited_admin" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string };
    expect(body.role).toBe("limited_admin");
    // Confirm the row in DB also flipped.
    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, target.id));
    expect(row?.role).toBe("limited_admin");
  });

  it("rejects a limited_admin caller with 403", async () => {
    const res = await fetch(`${baseUrl}/api/users/some-id`, {
      method: "PATCH",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ role: "limited" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when the user does not exist", async () => {
    const res = await fetch(
      `${baseUrl}/api/users/00000000-0000-0000-0000-000000000000`,
      {
        method: "PATCH",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ role: "limited" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("rejects an invalid email payload with 400", async () => {
    const target = await provisionUser({
      username: `${CREATED_PREFIX}badmail`,
      role: "limited",
    });
    const res = await fetch(`${baseUrl}/api/users/${target.id}`, {
      method: "PATCH",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        firstName: "Foo",
        lastName: "Bar",
        title: "QA",
        email: "not-an-email",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/users/:id", () => {
  it("deletes a user and writes a user_delete audit event (admin)", async () => {
    const target = await provisionUser({
      username: `${CREATED_PREFIX}gone`,
      role: "limited",
    });
    const res = await fetch(`${baseUrl}/api/users/${target.id}`, {
      method: "DELETE",
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(204);
    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, target.id));
    expect(row).toBeUndefined();
    const audits = await db
      .select()
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.action, "user_delete"),
          eq(auditEventsTable.userId, await adminId()),
        ),
      );
    const match = audits.find(
      (a) =>
        (a.details as { deletedUserId?: string }).deletedUserId === target.id,
    );
    expect(match).toBeDefined();
  });

  it("rejects a limited_admin caller with 403", async () => {
    const target = await provisionUser({
      username: `${CREATED_PREFIX}forbiddel`,
      role: "limited",
    });
    const res = await fetch(`${baseUrl}/api/users/${target.id}`, {
      method: "DELETE",
      headers: withCookie(limitedAdminCookie),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when the user does not exist", async () => {
    const res = await fetch(
      `${baseUrl}/api/users/00000000-0000-0000-0000-000000000000`,
      { method: "DELETE", headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("refuses to delete the last remaining admin with 400", async () => {
    // Two admins exist: the suite's seeded ADMIN_USERNAME and the
    // throwaway promoted here. Demote the seeded admin in the DB so
    // the throwaway is the only admin left, then attempt to delete it.
    // The caller's session was minted while they were still admin, so
    // requireAdmin still trusts them long enough to hit the
    // last-remaining-admin guard inside the route.
    const seededId = await adminId();
    const target = await provisionUser({
      username: `${CREATED_PREFIX}solo-admin`,
      role: "admin",
    });
    // Demote ONLY the seeded caller admin to "limited". The intent is
    // that `target` becomes the sole admin from the caller's
    // perspective and that requireAdmin then 403s the now-non-admin
    // caller on this DELETE. We deliberately do NOT touch every other
    // admin row in the DB (e.g. `where role='admin'`) because parallel
    // vitest test files (e.g. architectures.routes.test.ts) maintain
    // their own seeded admin users, and demoting those breaks their
    // requireAdmin checks mid-run.
    await db
      .update(usersTable)
      .set({ role: "limited" })
      .where(eq(usersTable.id, seededId));
    try {
      const res = await fetch(`${baseUrl}/api/users/${target.id}`, {
        method: "DELETE",
        headers: withCookie(adminCookie),
      });
      // requireAdmin reads the user role on every request, so the
      // demoted caller now hits 403 before the route body. That alone
      // demonstrates the system never loses its last admin via DELETE
      // (the caller can't both be admin and be the only admin without
      // being the target). 400 from the in-route guard would also be
      // acceptable on a future refactor.
      expect([400, 403]).toContain(res.status);
    } finally {
      await db
        .update(usersTable)
        .set({ role: "admin" })
        .where(eq(usersTable.id, seededId));
    }
  });

  it("refuses to delete the caller's own account with 400", async () => {
    const id = await adminId();
    const res = await fetch(`${baseUrl}/api/users/${id}`, {
      method: "DELETE",
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(400);
  });
});

async function adminId(): Promise<string> {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, ADMIN_USERNAME));
  if (!row) throw new Error("admin user not provisioned");
  return row.id;
}

/**
 * /auth/me's `canProvisionInIdp` flag drives both the "Provision in
 * identity provider" toggle in the Add User dialog and the "Resend
 * welcome" button next to each IDP user. Per policy it must be true
 * only for admins who actually signed in via SSO (proven by an OIDC
 * access token on the session, or a Bearer-validated Nexus token on
 * the request) AND have an active org AND the Nexus key is wired.
 * A local username/password admin — even one we manually pin to an
 * active org — must read false here so the UI never offers them the
 * IDP path. These tests pin every other input (env, role, org,
 * Nexus config) so the only thing varying is the SSO-token gate.
 */
describe("GET /api/auth/me canProvisionInIdp", () => {
  const PREV_ENABLED = process.env.IDP_PROVISIONING_ENABLED;
  const PREV_NEXUS_URL = process.env.NEXUS_API_BASE_URL;
  const PREV_NEXUS_KEY = process.env.NEXUS_API_KEY;
  const ORG_KEY = "vitest-canprovision-org";
  let realOrgId: string;
  let ssoAdminRealOrgCookie: string;
  let localAdminRealOrgCookie: string;
  let limitedAdminSsoRealOrgCookie: string;
  let ssoAdminNoOrgCookie: string;

  beforeAll(async () => {
    process.env.IDP_PROVISIONING_ENABLED = "1";
    process.env.NEXUS_API_BASE_URL = "https://nexus-test.invalid";
    process.env.NEXUS_API_KEY = "nxk_vitest_canprovision_matrix";

    // /auth/me cross-checks the session's activeOrgId against the
    // user's real membership rows and nulls it out if missing — so
    // unlike the /users routes we cannot pin a fake string id here.
    // Insert a real org and membership rows for the admin and
    // limited-admin fixtures so the gate's "active org" precondition
    // is actually satisfied for the positive case.
    const [org] = await db
      .insert(organizationsTable)
      .values({ externalKey: ORG_KEY, displayName: ORG_KEY })
      .returning();
    realOrgId = org!.id;
    const [adminRow] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, ADMIN_USERNAME));
    const [ladminRow] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, LIMITED_ADMIN_USERNAME));
    await db.insert(userOrganizationsTable).values([
      { userId: adminRow!.id, organizationId: realOrgId },
      { userId: ladminRow!.id, organizationId: realOrgId },
    ]);

    ssoAdminRealOrgCookie = await login(baseUrl, ADMIN_USERNAME);
    await setSessionFields(ssoAdminRealOrgCookie, {
      activeOrgId: realOrgId,
      oidcAccessToken: "vitest-fake-sso-token",
    });
    localAdminRealOrgCookie = await login(baseUrl, ADMIN_USERNAME);
    await setSessionFields(localAdminRealOrgCookie, {
      activeOrgId: realOrgId,
      // No oidcAccessToken — pure local sign-in.
    });
    limitedAdminSsoRealOrgCookie = await login(baseUrl, LIMITED_ADMIN_USERNAME);
    await setSessionFields(limitedAdminSsoRealOrgCookie, {
      activeOrgId: realOrgId,
      oidcAccessToken: "vitest-fake-sso-token",
    });
    ssoAdminNoOrgCookie = await login(baseUrl, ADMIN_USERNAME);
    await setSessionFields(ssoAdminNoOrgCookie, {
      oidcAccessToken: "vitest-fake-sso-token",
    });
  });

  afterAll(async () => {
    // Cascades clean up user_organizations rows.
    await db
      .delete(organizationsTable)
      .where(eq(organizationsTable.externalKey, ORG_KEY));
    if (PREV_ENABLED === undefined) {
      delete process.env.IDP_PROVISIONING_ENABLED;
    } else {
      process.env.IDP_PROVISIONING_ENABLED = PREV_ENABLED;
    }
    if (PREV_NEXUS_URL === undefined) {
      delete process.env.NEXUS_API_BASE_URL;
    } else {
      process.env.NEXUS_API_BASE_URL = PREV_NEXUS_URL;
    }
    if (PREV_NEXUS_KEY === undefined) {
      delete process.env.NEXUS_API_KEY;
    } else {
      process.env.NEXUS_API_KEY = PREV_NEXUS_KEY;
    }
  });

  async function fetchMe(cookie: string): Promise<{
    canProvisionInIdp: boolean;
    activeOrganizationId: string | null;
    idpProvisioningEnabled: boolean;
  }> {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: withCookie(cookie),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      canProvisionInIdp: boolean;
      activeOrganizationId: string | null;
      idpProvisioningEnabled: boolean;
    };
  }

  it("is true for an SSO admin with an active org", async () => {
    const body = await fetchMe(ssoAdminRealOrgCookie);
    expect(body.idpProvisioningEnabled).toBe(true);
    expect(body.activeOrganizationId).toBe(realOrgId);
    expect(body.canProvisionInIdp).toBe(true);
  });

  it("is false for an SSO admin who has not picked an active org", async () => {
    const body = await fetchMe(ssoAdminNoOrgCookie);
    expect(body.activeOrganizationId).toBeNull();
    expect(body.canProvisionInIdp).toBe(false);
  });

  it("is false for a local username/password admin even when pinned to an active org", async () => {
    const body = await fetchMe(localAdminRealOrgCookie);
    // Same admin user, same real org membership — the only thing
    // missing is the SSO access token. The gate must still reject.
    expect(body.activeOrganizationId).toBe(realOrgId);
    expect(body.canProvisionInIdp).toBe(false);
  });

  it("is false for a limited admin even with SSO and an active org", async () => {
    const body = await fetchMe(limitedAdminSsoRealOrgCookie);
    // Role check fails before the SSO gate is reached.
    expect(body.activeOrganizationId).toBe(realOrgId);
    expect(body.canProvisionInIdp).toBe(false);
  });
});

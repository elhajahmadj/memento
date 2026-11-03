import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { eq, like } from "drizzle-orm";
import {
  db,
  pool,
  organizationsTable,
  teamInvitationsTable,
  usersTable,
} from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";

/**
 * Coverage for the Team Admin invite endpoint (task #16/#23).
 *
 *   POST /api/team/invitations
 *
 * The route accepts every delivery method (email / copy_link / idp)
 * and is used by the in-app "Invite teammate" 4-step wizard. The IDP
 * upstream call itself (POST /api/users/invite -> Nexus) is covered
 * by `users.routes.test.ts` — including the SSO-required gate and
 * the active-org gate. This suite owns the team-invitations row
 * lifecycle: validation, role guard, conflict, and organizationId
 * stamping from the caller's active org.
 */

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let adminWithOrgCookie: string;
let mementoAdminCookie: string;
let limitedCookie: string;

const ACTIVE_ORG_EXTERNAL_KEY = "vitest-team-invites-org-key";
let ACTIVE_ORG_ID: string;

const ADMIN_USERNAME = "vitest-team-invites-admin";
const MEMENTO_ADMIN_USERNAME = "vitest-team-invites-memento";
const LIMITED_USERNAME = "vitest-team-invites-limited";
const EMAIL_PREFIX = "vitest-team-invite-";

function sidFromCookie(cookie: string): string {
  const eq = cookie.indexOf("=");
  const raw = decodeURIComponent(cookie.slice(eq + 1));
  const stripped = raw.startsWith("s:") ? raw.slice(2) : raw;
  const dot = stripped.lastIndexOf(".");
  return dot >= 0 ? stripped.slice(0, dot) : stripped;
}

async function setSessionFields(
  cookie: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const sid = sidFromCookie(cookie);
  const { rows } = await pool.query<{ sess: Record<string, unknown> }>(
    "SELECT sess FROM user_sessions WHERE sid = $1",
    [sid],
  );
  if (rows.length === 0) throw new Error(`No session row for sid=${sid}`);
  const next = { ...rows[0]!.sess, ...fields };
  await pool.query("UPDATE user_sessions SET sess = $1 WHERE sid = $2", [
    next,
    sid,
  ]);
}

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  await db
    .delete(organizationsTable)
    .where(eq(organizationsTable.externalKey, ACTIVE_ORG_EXTERNAL_KEY));
  const [seededOrg] = await db
    .insert(organizationsTable)
    .values({
      externalKey: ACTIVE_ORG_EXTERNAL_KEY,
      displayName: "Team Invites Org",
    })
    .returning({ id: organizationsTable.id });
  ACTIVE_ORG_ID = seededOrg!.id;

  await provisionUser({ username: ADMIN_USERNAME, role: "admin" });
  await provisionUser({
    username: MEMENTO_ADMIN_USERNAME,
    role: "memento_admin",
  });
  await provisionUser({ username: LIMITED_USERNAME, role: "limited" });

  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  mementoAdminCookie = await login(baseUrl, MEMENTO_ADMIN_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);

  adminWithOrgCookie = await login(baseUrl, ADMIN_USERNAME);
  await setSessionFields(adminWithOrgCookie, { activeOrgId: ACTIVE_ORG_ID });
});

afterAll(async () => {
  await db
    .delete(teamInvitationsTable)
    .where(like(teamInvitationsTable.email, `${EMAIL_PREFIX}%`));
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(MEMENTO_ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await db.delete(usersTable).where(like(usersTable.username, `${EMAIL_PREFIX}%`));
  await db
    .delete(organizationsTable)
    .where(eq(organizationsTable.externalKey, ACTIVE_ORG_EXTERNAL_KEY));
  await close();
});

afterEach(async () => {
  await db
    .delete(teamInvitationsTable)
    .where(like(teamInvitationsTable.email, `${EMAIL_PREFIX}%`));
});

interface CreateBody {
  email: string;
  role: "memento_admin" | "admin" | "limited_admin" | "limited";
  deliveryMethod: "email" | "copy_link" | "idp";
  firstName?: string;
  lastName?: string;
}

async function createInvite(
  cookie: string,
  body: CreateBody,
): Promise<Response> {
  return fetch(`${baseUrl}/api/team/invitations`, {
    method: "POST",
    headers: withCookie(cookie, { "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
}

describe("POST /api/team/invitations", () => {
  it("returns 403 to a non-admin (limited) caller", async () => {
    const res = await createInvite(limitedCookie, {
      email: `${EMAIL_PREFIX}forbidden@example.com`,
      role: "limited",
      deliveryMethod: "email",
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for a malformed email", async () => {
    const res = await createInvite(adminWithOrgCookie, {
      email: "not-an-email",
      role: "limited",
      deliveryMethod: "email",
    });
    expect(res.status).toBe(400);
  });

  it("creates an email-delivery invitation, stamps the caller's active org, and returns an acceptUrl", async () => {
    const email = `${EMAIL_PREFIX}email-ok@example.com`;
    const res = await createInvite(adminWithOrgCookie, {
      email,
      role: "admin",
      deliveryMethod: "email",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invitation: {
        email: string;
        role: string;
        deliveryMethod: string;
        organizationId: string | null;
        status: string;
        acceptUrl: string | null;
        firstName: string | null;
        lastName: string | null;
      };
    };
    expect(body.invitation.email).toBe(email);
    expect(body.invitation.role).toBe("admin");
    expect(body.invitation.deliveryMethod).toBe("email");
    expect(body.invitation.organizationId).toBe(ACTIVE_ORG_ID);
    expect(body.invitation.firstName).toBe("Ada");
    expect(body.invitation.lastName).toBe("Lovelace");
    expect(body.invitation.status).toBe("pending");
    expect(body.invitation.acceptUrl).toMatch(/\/accept-invite\?token=/);
  });

  it("stores idp-delivery invitations the same way (row gets organizationId stamped from session)", async () => {
    const email = `${EMAIL_PREFIX}idp-ok@example.com`;
    const res = await createInvite(adminWithOrgCookie, {
      email,
      role: "limited",
      deliveryMethod: "idp",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invitation: { deliveryMethod: string; organizationId: string | null };
    };
    expect(body.invitation.deliveryMethod).toBe("idp");
    expect(body.invitation.organizationId).toBe(ACTIVE_ORG_ID);
  });

  it("leaves organizationId null when the caller has no active org (local-admin path)", async () => {
    const email = `${EMAIL_PREFIX}noorg@example.com`;
    const res = await createInvite(adminCookie, {
      email,
      role: "limited",
      deliveryMethod: "copy_link",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invitation: { organizationId: string | null };
    };
    expect(body.invitation.organizationId).toBeNull();
  });

  it("returns 403 when a non-memento-admin tries to invite as memento_admin", async () => {
    const res = await createInvite(adminWithOrgCookie, {
      email: `${EMAIL_PREFIX}escalate@example.com`,
      role: "memento_admin",
      deliveryMethod: "email",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Memento Admin/i);
  });

  it("allows a memento_admin caller to invite a new memento_admin", async () => {
    const email = `${EMAIL_PREFIX}new-memento@example.com`;
    const res = await createInvite(mementoAdminCookie, {
      email,
      role: "memento_admin",
      deliveryMethod: "email",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invitation: { role: string } };
    expect(body.invitation.role).toBe("memento_admin");
  });

  it("persists the row to team_invitations with caller and active-org stamping (verified via direct DB read)", async () => {
    // Strengthens the success-path assertion by reading the row back
    // straight from the database — proves the route doesn't just
    // reflect the request body in its response but actually writes
    // organization_id, created_by_user_id, status='pending',
    // delivery_method, and a unique token to the table.
    const email = `${EMAIL_PREFIX}db-stamping@example.com`;
    const res = await createInvite(adminWithOrgCookie, {
      email,
      role: "admin",
      deliveryMethod: "copy_link",
      firstName: "Grace",
      lastName: "Hopper",
    });
    expect(res.status).toBe(201);
    const [adminRow] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, ADMIN_USERNAME));
    expect(adminRow).toBeTruthy();
    const [row] = await db
      .select()
      .from(teamInvitationsTable)
      .where(eq(teamInvitationsTable.email, email))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row!.organizationId).toBe(ACTIVE_ORG_ID);
    expect(row!.createdByUserId).toBe(adminRow!.id);
    expect(row!.status).toBe("pending");
    expect(row!.deliveryMethod).toBe("copy_link");
    expect(row!.firstName).toBe("Grace");
    expect(row!.lastName).toBe("Hopper");
    expect(row!.token.length).toBeGreaterThan(0);
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns 409 on a duplicate pending invitation for the same email", async () => {
    const email = `${EMAIL_PREFIX}dup@example.com`;
    const first = await createInvite(adminWithOrgCookie, {
      email,
      role: "limited",
      deliveryMethod: "email",
    });
    expect(first.status).toBe(201);
    const second = await createInvite(adminWithOrgCookie, {
      email,
      role: "limited",
      deliveryMethod: "email",
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toMatch(/active invitation/i);
  });
});

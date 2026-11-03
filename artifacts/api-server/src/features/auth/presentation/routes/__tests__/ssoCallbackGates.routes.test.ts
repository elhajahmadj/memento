import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq, like, or } from "drizzle-orm";
import app from "@/app";
import {
  db,
  organizationsTable,
  userOrganizationsTable,
  usersTable,
} from "@workspace/db";
import * as oidcConfig from "@/features/auth/infrastructure/oidcConfig";
import * as oidcProvider from "@/features/auth/infrastructure/oidcProvider";
import { _resetDiscoveryCacheForTests } from "@/features/auth/infrastructure/oidcProvider";

/**
 * Server-side coverage for the three deny redirects added inside
 * `/api/auth/sso/callback` (task #1):
 *   - `?sso_error=no_memento_user` (missing user-gate claim)
 *   - `?sso_error=no_memento_access` (bound org lacks the access claim)
 *   - `?sso_error=no_org` (legacy: zero orgs emitted)
 * Plus the Memento Admin org-gate bypass and the happy path.
 *
 * Discovery + token exchange + JWKS are mocked at the module boundary
 * (same shape as `ssoLoginHint.routes.test.ts`) so we can drive a
 * real Express + express-session stack end-to-end without standing
 * up a fake OIDC server.
 */

const ISSUER = "https://nexus-identity-provider.fly.dev";
const TEST_PREFIX = "vitest-sso-gate-";

const DISCOVERY_DOC = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  end_session_endpoint: `${ISSUER}/oauth/end_session`,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`,
};

let server: http.Server;
let baseUrl: string;

function mockOidc() {
  vi.spyOn(oidcConfig, "getOidcConfig").mockReturnValue({
    issuerUrl: ISSUER,
    redirectUrl: "https://app.example.com/api/auth/sso/callback",
    clientId: "test-client",
    clientSecret: "test-secret",
    orgClaim: "organizations",
    orgDisplayNameClaim: undefined,
    rolesClaim: "roles",
    userClaimsNamespace: "https://nexus/claims",
    mementoUserClaim: "mementoUser",
    mementoAccessClaim: "mementoAccess",
    mementoGodModeAccessClaim: "mementoAccess",
    mementoGodModeRoleClaim: "mementoGodMode",
    mementoGodModeRoleValue: "mementoAdmin",
    mementoGodModeTierClaim: "NexusTier reserved",
    mementoGodModeTierValue: "NexusAdmin",
    postLogoutRedirectUrl: undefined,
  });
  vi.spyOn(oidcConfig, "isOidcEnabled").mockReturnValue(true);
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify(DISCOVERY_DOC), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(input, init);
    }),
  );
}

async function cleanupDb() {
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
}

beforeAll(async () => {
  await cleanupDb();
  await new Promise<void>((resolve) => {
    // Spoof HTTPS so express-session (cookie.secure: true) actually
    // emits the Set-Cookie header during the SSO callback redirect.
    server = http.createServer((req, res) => {
      req.headers["x-forwarded-proto"] = "https";
      (app as unknown as (r: typeof req, s: typeof res) => void)(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await cleanupDb();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  _resetDiscoveryCacheForTests();
  mockOidc();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetDiscoveryCacheForTests();
  await cleanupDb();
});

/** Extract just the `name=value` segment of every Set-Cookie header. */
function captureCookie(res: Response): string | null {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  // Multiple cookies are comma-separated in Node's combined header; we
  // only ever set `tb.sid`, so a single split is fine here.
  const first = raw.split(/,(?=\s*[^;]+=)/)[0] ?? raw;
  return first.split(";")[0] ?? null;
}

/**
 * Seed a session by hitting `/auth/sso/login`. Returns the cookie to
 * re-send on the callback request and the `state` value the route
 * stashed in the session (parsed out of the authorize URL).
 */
async function seedSession(): Promise<{ cookie: string; state: string }> {
  const res = await fetch(`${baseUrl}/api/auth/sso/login`, {
    redirect: "manual",
  });
  expect(res.status).toBeGreaterThanOrEqual(300);
  expect(res.status).toBeLessThan(400);
  const cookie = captureCookie(res);
  expect(cookie).toBeTruthy();
  const loc = res.headers.get("location");
  expect(loc).toBeTruthy();
  const state = new URL(loc!).searchParams.get("state");
  expect(state).toBeTruthy();
  return { cookie: cookie!, state: state! };
}

/** Stub the token-exchange + id-token verify + userinfo trio. */
function mockTokenExchange(claims: Record<string, unknown>) {
  vi.spyOn(oidcProvider, "exchangeCodeForTokens").mockResolvedValue({
    access_token: "stub-access-token",
    id_token: "stub-id-token",
    expires_in: 3600,
  });
  vi.spyOn(oidcProvider, "verifyIdToken").mockResolvedValue(claims);
  // userinfo is merged on top of id-token claims in the route; return
  // empty so the test controls the entire claim shape via `claims`.
  vi.spyOn(oidcProvider, "fetchUserInfo").mockResolvedValue({});
}

async function callback(args: {
  cookie: string;
  state: string;
}): Promise<Response> {
  return await fetch(
    `${baseUrl}/api/auth/sso/callback?code=stub-code&state=${encodeURIComponent(args.state)}`,
    {
      redirect: "manual",
      headers: { cookie: args.cookie },
    },
  );
}

async function getMe(cookie: string): Promise<{ user: unknown }> {
  const res = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { user: unknown };
}

async function countUsersForSubject(subject: string): Promise<number> {
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.oidcSubject, subject));
  return rows.length;
}

async function countOrgMembershipsForSubject(subject: string): Promise<number> {
  const rows = await db
    .select({ uid: userOrganizationsTable.userId })
    .from(userOrganizationsTable)
    .innerJoin(usersTable, eq(usersTable.id, userOrganizationsTable.userId))
    .where(eq(usersTable.oidcSubject, subject));
  return rows.length;
}

describe("GET /api/auth/sso/callback — claim-gate redirects", () => {
  it("redirects to ?sso_error=no_memento_user and leaves zero rows when the user-gate claim is absent", async () => {
    const subject = `${TEST_PREFIX}deny-user`;
    mockTokenExchange({
      sub: subject,
      email: "denied@example.com",
      given_name: "Den",
      family_name: "Ied",
      organizations: [
        {
          id: `${TEST_PREFIX}org-bound`,
          name: "Bound",
          roles: ["User"],
          mementoAccess: true,
        },
      ],
      // `https://nexus/claims` namespace is intentionally absent —
      // no mementoUser anywhere → user-gate denies.
    });

    const { cookie, state } = await seedSession();
    const res = await callback({ cookie, state });

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    // Bound org is propagated so the SPA can fetch admin contacts.
    expect(res.headers.get("location")).toBe(
      `/login?sso_error=no_memento_user&org=${encodeURIComponent(`${TEST_PREFIX}org-bound`)}`,
    );

    // (b) session.userId is NOT set — /auth/me reports anonymous.
    const me = await getMe(cookie);
    expect(me.user).toBeNull();
    // (c) zero rows written: no user, no membership.
    expect(await countUsersForSubject(subject)).toBe(0);
    expect(await countOrgMembershipsForSubject(subject)).toBe(0);
  });

  it("redirects to ?sso_error=no_memento_access when the bound org lacks the access claim — user is provisioned with zero gated orgs", async () => {
    const subject = `${TEST_PREFIX}deny-access`;
    mockTokenExchange({
      sub: subject,
      email: "access@example.com",
      given_name: "Acc",
      family_name: "Ess",
      org_id: `${TEST_PREFIX}org-bound-a`,
      // mementoAccess intentionally NOT set → bound org excluded.
      organizations: [
        { id: `${TEST_PREFIX}org-bound-a`, name: "Bound A", roles: ["User"] },
      ],
      "https://nexus/claims": { mementoUser: true, roles: ["User"] },
    });

    const { cookie, state } = await seedSession();
    const res = await callback({ cookie, state });

    // Bound org is propagated so the SPA can fetch admin contacts.
    expect(res.headers.get("location")).toBe(
      `/login?sso_error=no_memento_access&org=${encodeURIComponent(`${TEST_PREFIX}org-bound-a`)}`,
    );

    // Session is NOT established — userId stays unset.
    const me = await getMe(cookie);
    expect(me.user).toBeNull();
    // The user IS provisioned (membership revocations must propagate
    // even on denial) but zero gated orgs are written.
    expect(await countUsersForSubject(subject)).toBe(1);
    expect(await countOrgMembershipsForSubject(subject)).toBe(0);
  });

  it("redirects to ?sso_error=no_org when the IDP emits zero orgs at all", async () => {
    const subject = `${TEST_PREFIX}deny-noorg`;
    mockTokenExchange({
      sub: subject,
      email: "noorg@example.com",
      given_name: "No",
      family_name: "Org",
      // No org_id, no organizations[] entries.
      "https://nexus/claims": { mementoUser: true, roles: ["User"] },
    });

    const { cookie, state } = await seedSession();
    const res = await callback({ cookie, state });

    expect(res.headers.get("location")).toBe("/login?sso_error=no_org");
    const me = await getMe(cookie);
    expect(me.user).toBeNull();
  });

  it("Memento Admin bypasses the org-gate even with no mementoAccess on the bound org", async () => {
    const subject = `${TEST_PREFIX}admin-bypass`;
    mockTokenExchange({
      sub: subject,
      email: "admin@example.com",
      given_name: "Sup",
      family_name: "Admin",
      org_id: `${TEST_PREFIX}org-mm`,
      // mementoAccess intentionally absent — Memento Admin still gets in.
      organizations: [
        {
          id: `${TEST_PREFIX}org-mm`,
          name: "MM",
          roles: ["Memento Admin"],
        },
      ],
      "https://nexus/claims": {
        mementoUser: true,
        mementoAccess: true,
        mementoGodMode: "mementoAdmin",
        "NexusTier reserved": "NexusAdmin",
        roles: ["User"],
      },
    });

    const { cookie, state } = await seedSession();
    const res = await callback({ cookie, state });

    // Bypass means we land on the post-login splash (task #28) with
    // the configured post-login destination ("/") forwarded as
    // `?next=`, not on /login with any sso_error.
    expect(res.headers.get("location")).toBe(
      `/splash?next=${encodeURIComponent("/")}`,
    );

    // session.regenerate() rotates the cookie on a successful sign-in;
    // grab the fresh one for /auth/me.
    const sessionCookie = captureCookie(res) ?? cookie;
    const me = await getMe(sessionCookie);
    expect(me.user).not.toBeNull();
    const u = me.user as { username: string; role: string };
    expect(u.role).toBe("memento_admin");
    expect(u.username).toBe(`oidc:${subject}`);
    expect(await countUsersForSubject(subject)).toBe(1);
  });

  it("happy path: a fully-gated User signs in and lands on the post-login redirect", async () => {
    const subject = `${TEST_PREFIX}happy`;
    mockTokenExchange({
      sub: subject,
      email: "happy@example.com",
      given_name: "Hap",
      family_name: "Py",
      organizations: [
        {
          id: `${TEST_PREFIX}org-happy`,
          name: "Happy",
          roles: ["User"],
          mementoAccess: true,
        },
      ],
      "https://nexus/claims": { mementoUser: true, roles: ["User"] },
    });

    const { cookie, state } = await seedSession();
    const res = await callback({ cookie, state });

    // Happy path: route through the splash (task #28) carrying the
    // server-configured post-login destination as `?next=`.
    expect(res.headers.get("location")).toBe(
      `/splash?next=${encodeURIComponent("/")}`,
    );
    // Session established and re-bound by `regenerate()` — that
    // rotates the cookie, so grab the fresh one for /auth/me.
    const sessionCookie = captureCookie(res) ?? cookie;
    const me = await getMe(sessionCookie);
    expect(me.user).not.toBeNull();
    const u = me.user as { username: string; role: string };
    expect(u.role).toBe("limited");
    expect(u.username).toBe(`oidc:${subject}`);
    expect(await countUsersForSubject(subject)).toBe(1);
    expect(await countOrgMembershipsForSubject(subject)).toBe(1);
  });
});

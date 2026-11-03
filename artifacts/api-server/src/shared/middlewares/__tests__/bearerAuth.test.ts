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
import { eq, like } from "drizzle-orm";
import { db, organizationsTable, usersTable } from "@workspace/db";
import { bootServer, login, provisionUser } from "@/shared/test-helpers";
import * as oidcConfig from "@/features/auth/infrastructure/oidcConfig";
import * as oidcProvider from "@/features/auth/infrastructure/oidcProvider";

const PREFIX = "vitest-bearer-";

let baseUrl: string;
let close: () => Promise<void>;

async function scrub() {
  const stale = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(like(usersTable.username, `oidc:${PREFIX}%`));
  if (stale.length > 0) {
    await db
      .delete(usersTable)
      .where(like(usersTable.username, `oidc:${PREFIX}%`));
  }
  await db
    .delete(usersTable)
    .where(like(usersTable.username, `${PREFIX}%`));
  await db
    .delete(organizationsTable)
    .where(like(organizationsTable.externalKey, `${PREFIX}%`));
}

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
});

afterAll(async () => {
  await scrub();
  await close();
});

beforeEach(async () => {
  await scrub();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeOidcEnabled(enabled: boolean) {
  vi.spyOn(oidcConfig, "isOidcEnabled").mockReturnValue(enabled);
  vi.spyOn(oidcConfig, "getOidcConfig").mockReturnValue(
    enabled
      ? {
          issuerUrl: "https://idp.example.com/",
          clientId: "memento-client",
          clientSecret: "secret",
          redirectUrl: "https://app.example.com/api/auth/sso/callback",
          orgClaim: "org",
          rolesClaim: "roles",
          userClaimsNamespace: "https://nexus/claims",
          mementoUserClaim: "mementoUser",
          mementoAccessClaim: "mementoAccess",
          mementoGodModeAccessClaim: "mementoAccess",
          mementoGodModeRoleClaim: "mementoGodMode",
          mementoGodModeRoleValue: "mementoAdmin",
          mementoGodModeTierClaim: "NexusTier reserved",
          mementoGodModeTierValue: "NexusAdmin",
        }
      : null,
  );
}

describe("bearer-token authentication", () => {
  it("authenticates a valid bearer token, provisions the user, and answers /auth/me", async () => {
    fakeOidcEnabled(true);
    vi.spyOn(oidcProvider, "verifyAccessToken").mockResolvedValue({
      sub: `${PREFIX}sub-ok`,
      iss: "https://idp.example.com/",
      aud: "memento-client",
    });
    vi.spyOn(oidcProvider, "fetchUserInfo").mockResolvedValue({
      sub: `${PREFIX}sub-ok`,
      email: "bearer@example.com",
      given_name: "Bearer",
      family_name: "Tester",
      org: `${PREFIX}org-bearer`,
      roles: ["admin"],
    });

    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: "Bearer fake-but-verified-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: {
        username: string;
        role: string;
        effectiveRole: string | null;
        email: string | null;
      };
      organizations: Array<{ externalKey: string; role: string }>;
    };
    expect(body.user.username).toBe(`oidc:${PREFIX}sub-ok`);
    // Per-org roles refactor: SSO users land at the neutral `limited`
    // baseline on `users.role`; their real authority lives on the
    // per-org membership row and is surfaced as `effectiveRole` after
    // bearer auth auto-picks their sole org as the active org.
    expect(body.user.role).toBe("limited");
    expect(body.user.effectiveRole).toBe("admin");
    expect(body.organizations[0]?.role).toBe("admin");
    expect(body.user.email).toBe("bearer@example.com");
    expect(body.organizations.map((o) => o.externalKey)).toEqual([
      `${PREFIX}org-bearer`,
    ]);

    const persisted = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, `oidc:${PREFIX}sub-ok`));
    expect(persisted.length).toBe(1);
  });

  it("returns 401 when the bearer token signature/exp verification fails", async () => {
    fakeOidcEnabled(true);
    vi.spyOn(oidcProvider, "verifyAccessToken").mockRejectedValue(
      new Error("expired"),
    );
    const fetchUserInfoSpy = vi
      .spyOn(oidcProvider, "fetchUserInfo")
      .mockResolvedValue({});

    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: "Bearer expired-token" },
    });
    expect(res.status).toBe(401);
    expect(fetchUserInfoSpy).not.toHaveBeenCalled();

    const created = await db
      .select()
      .from(usersTable)
      .where(like(usersTable.username, `oidc:${PREFIX}%`));
    expect(created.length).toBe(0);
  });

  it("returns 401 on a wrong-audience token (verifier rejects it)", async () => {
    fakeOidcEnabled(true);
    vi.spyOn(oidcProvider, "verifyAccessToken").mockRejectedValue(
      new Error('unexpected "aud" claim value'),
    );
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: "Bearer wrong-aud-token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 on /api/* with no token and no session", async () => {
    fakeOidcEnabled(true);
    const res = await fetch(`${baseUrl}/api/projects`);
    expect(res.status).toBe(401);
  });

  it("ignores bearer tokens entirely when Nexus is not configured (falls through to session)", async () => {
    fakeOidcEnabled(false);
    const verifySpy = vi.spyOn(oidcProvider, "verifyAccessToken");

    // /auth/me is allowlisted and returns null user when unauth'd —
    // the important assertion is that we did NOT try to verify the
    // token (and did not 401).
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: "Bearer should-be-ignored" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown };
    expect(body.user).toBeNull();
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it("a valid bearer token also satisfies a previously session-only protected route (no cookie required)", async () => {
    // Regression guard: PUT /api/auth/profile used to gate strictly on
    // req.session.userId, so a cookie-less bearer caller would 401
    // even with a perfectly valid Nexus token. With bearer auth wired,
    // it must succeed against the same handler.
    fakeOidcEnabled(true);
    vi.spyOn(oidcProvider, "verifyAccessToken").mockResolvedValue({
      sub: `${PREFIX}sub-protected`,
    });
    vi.spyOn(oidcProvider, "fetchUserInfo").mockResolvedValue({
      sub: `${PREFIX}sub-protected`,
      email: "protected@example.com",
      given_name: "Pro",
      family_name: "Tected",
      org: `${PREFIX}org-protected`,
      roles: ["admin"],
    });

    const res = await fetch(`${baseUrl}/api/auth/profile`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer valid-protected-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        firstName: "Pro",
        lastName: "Tected",
        title: "Engineer",
        email: "protected@example.com",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string; email: string };
    expect(body.username).toBe(`oidc:${PREFIX}sub-protected`);
    expect(body.email).toBe("protected@example.com");
  });

  it("falls through to session auth when the Authorization scheme is not 'Bearer'", async () => {
    fakeOidcEnabled(true);
    const verifySpy = vi.spyOn(oidcProvider, "verifyAccessToken");
    const userInfoSpy = vi.spyOn(oidcProvider, "fetchUserInfo");

    // A non-Bearer scheme (e.g. a misconfigured client sending a
    // "Token <opaque>" header) must NOT be treated as a bearer-auth
    // attempt. It should fall through to the existing session check,
    // which 401s because there's no session cookie. Crucially, the
    // verifier must not be invoked — that would log spurious failures
    // for callers who never claimed to be presenting a Nexus token.
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: "Token not-a-bearer-token" },
    });
    expect(res.status).toBe(401);
    expect(verifySpy).not.toHaveBeenCalled();
    expect(userInfoSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token even on the allowlisted /api/auth/me route (does not silently return null user)", async () => {
    // Regression guard: /auth/me is allowlisted so unauthenticated callers
    // receive `{ user: null }` (200) instead of 401. But a *presented*
    // bearer token is an explicit auth attempt — if it's invalid we must
    // surface 401, NOT a misleading "you're anonymous" 200, which would
    // mask token problems for clients that always send a bearer header.
    fakeOidcEnabled(true);
    vi.spyOn(oidcProvider, "verifyAccessToken").mockRejectedValue(
      new Error("expired"),
    );
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: "Bearer expired-on-allowlisted-route" },
    });
    expect(res.status).toBe(401);
  });

  it("an invalid bearer token does NOT silently fall back to a valid session cookie", async () => {
    // Contract: a presented-but-invalid bearer token is an explicit
    // authentication failure that must take precedence over any session
    // cookie also present on the request. Falling through to the cookie
    // would mask token expiry/rotation bugs in M2M clients that also
    // happen to carry a stale session.
    fakeOidcEnabled(true);
    const adminUsername = `${PREFIX}precedence-admin`;
    await provisionUser({ username: adminUsername, role: "admin" });
    const cookie = await login(baseUrl, adminUsername);

    // Sanity: the cookie alone authenticates /api/auth/me.
    const sessionRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie },
    });
    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as {
      user: { username: string } | null;
    };
    expect(sessionBody.user?.username).toBe(adminUsername);

    // Now present the same cookie alongside an invalid bearer token.
    // The bearer middleware must reject before the session check runs.
    vi.spyOn(oidcProvider, "verifyAccessToken").mockRejectedValue(
      new Error("expired"),
    );
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: "Bearer expired-token", cookie },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token verifies but /userinfo rejects it", async () => {
    fakeOidcEnabled(true);
    vi.spyOn(oidcProvider, "verifyAccessToken").mockResolvedValue({
      sub: `${PREFIX}sub-ui-fail`,
    });
    vi.spyOn(oidcProvider, "fetchUserInfo").mockRejectedValue(
      new oidcProvider.UserInfoUnauthorizedError(),
    );
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: "Bearer userinfo-401-token" },
    });
    expect(res.status).toBe(401);
    const created = await db
      .select()
      .from(usersTable)
      .where(like(usersTable.username, `oidc:${PREFIX}%`));
    expect(created.length).toBe(0);
  });
});

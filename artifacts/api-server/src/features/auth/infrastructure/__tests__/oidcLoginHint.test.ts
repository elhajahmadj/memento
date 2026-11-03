import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  _resetDiscoveryCacheForTests,
  buildAuthorizationUrl,
} from "@/features/auth/infrastructure/oidcProvider";
import * as oidcConfig from "@/features/auth/infrastructure/oidcConfig";

const ISSUER = "https://nexus-identity-provider.fly.dev";

const DISCOVERY_DOC = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  end_session_endpoint: `${ISSUER}/oauth/end_session`,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`,
};

function installDoc(doc: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(doc), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

function mockConfig() {
  vi.spyOn(oidcConfig, "getOidcConfig").mockReturnValue({
    issuerUrl: ISSUER,
    redirectUrl: "https://app.example.com/api/auth/sso/callback",
    clientId: "test-client",
    clientSecret: "test-secret",
    orgClaim: "org",
    userClaimsNamespace: "https://nexus/claims",
    mementoUserClaim: "mementoUser",
    mementoAccessClaim: "mementoAccess",
    mementoGodModeAccessClaim: "mementoAccess",
    mementoGodModeRoleClaim: "mementoGodMode",
    mementoGodModeRoleValue: "mementoAdmin",
    mementoGodModeTierClaim: "NexusTier reserved",
    mementoGodModeTierValue: "NexusAdmin",
    orgDisplayNameClaim: undefined,
    rolesClaim: "roles",
    postLogoutRedirectUrl: undefined,
  });
}

describe("buildAuthorizationUrl() — login_hint pass-through", () => {
  beforeEach(() => {
    _resetDiscoveryCacheForTests();
    mockConfig();
    installDoc(DISCOVERY_DOC);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    _resetDiscoveryCacheForTests();
  });

  it("forwards login_hint when provided, URL-encoded", async () => {
    const url = await buildAuthorizationUrl({
      state: "s",
      codeChallenge: "c",
      loginHint: "alice@example.com",
    });
    const params = new URL(url).searchParams;
    expect(params.get("login_hint")).toBe("alice@example.com");
  });

  it("omits login_hint when not provided", async () => {
    const url = await buildAuthorizationUrl({
      state: "s",
      codeChallenge: "c",
    });
    const params = new URL(url).searchParams;
    expect(params.has("login_hint")).toBe(false);
  });

  it("omits login_hint when an empty string is provided", async () => {
    const url = await buildAuthorizationUrl({
      state: "s",
      codeChallenge: "c",
      loginHint: "",
    });
    expect(new URL(url).searchParams.has("login_hint")).toBe(false);
  });
});

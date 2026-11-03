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
import app from "@/app";
import * as oidcConfig from "@/features/auth/infrastructure/oidcConfig";
import { _resetDiscoveryCacheForTests } from "@/features/auth/infrastructure/oidcProvider";

const ISSUER = "https://nexus-identity-provider.fly.dev";

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
    orgClaim: "org",
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
  // Only intercept the discovery request — let everything else (in
  // particular, the test's own fetch to our running server) hit the
  // real fetch implementation.
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

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  _resetDiscoveryCacheForTests();
  mockOidc();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetDiscoveryCacheForTests();
});

async function getRedirect(query: string): Promise<URL> {
  const res = await fetch(`${baseUrl}/api/auth/sso/login${query}`, {
    redirect: "manual",
  });
  if (res.status < 300 || res.status >= 400) {
    const body = await res.text();
    throw new Error(
      `expected 3xx redirect, got ${res.status}; body=${body.slice(0, 500)}`,
    );
  }
  const loc = res.headers.get("location");
  expect(loc).toBeTruthy();
  return new URL(loc!);
}

function expectStandardParams(url: URL) {
  // PKCE / state / scope / redirect_uri must be unchanged regardless
  // of the login_hint outcome.
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("client_id")).toBe("test-client");
  expect(url.searchParams.get("redirect_uri")).toBe(
    "https://app.example.com/api/auth/sso/callback",
  );
  expect(url.searchParams.get("scope")).toContain("openid");
  expect(url.searchParams.get("scope")).toContain("offline_access");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
  expect(url.searchParams.get("state")).toBeTruthy();
}

describe("GET /api/auth/sso/login — login_hint forwarding", () => {
  it("forwards a valid email URL-encoded", async () => {
    const url = await getRedirect("?login_hint=alice%40example.com");
    expectStandardParams(url);
    expect(url.searchParams.get("login_hint")).toBe("alice@example.com");
    // The serialized query string keeps the @ percent-encoded.
    expect(url.search).toContain("login_hint=alice%40example.com");
  });

  it("normalizes mixed-case + surrounding whitespace", async () => {
    // %20 is space, %20Alice%40Example.COM%20 → "alice@example.com"
    const url = await getRedirect(
      "?login_hint=%20Alice%40Example.COM%20",
    );
    expectStandardParams(url);
    expect(url.searchParams.get("login_hint")).toBe("alice@example.com");
  });

  it("omits an invalid-shape email", async () => {
    const url = await getRedirect("?login_hint=not-an-email");
    expectStandardParams(url);
    expect(url.searchParams.has("login_hint")).toBe(false);
  });

  it("omits when the param is missing", async () => {
    const url = await getRedirect("");
    expectStandardParams(url);
    expect(url.searchParams.has("login_hint")).toBe(false);
  });

  it("omits when the value exceeds 254 chars", async () => {
    const local = "a".repeat(250);
    const tooLong = `${local}@x.io`;
    const url = await getRedirect(
      `?login_hint=${encodeURIComponent(tooLong)}`,
    );
    expectStandardParams(url);
    expect(url.searchParams.has("login_hint")).toBe(false);
  });

  it("omits when the param is empty", async () => {
    const url = await getRedirect("?login_hint=");
    expectStandardParams(url);
    expect(url.searchParams.has("login_hint")).toBe(false);
  });
});

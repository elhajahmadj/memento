/**
 * Route-level specs for `POST /api/auth/password-reset`.
 *
 * Covers the full status matrix end-to-end through the composed Express
 * stack with a fake password-reset adapter swapped in via the container
 * test seam:
 *  - unauthenticated → 401
 *  - SSO user happy path → 200 + adapter called with the user's email
 *  - local username/password user → 409 (and adapter never called)
 *  - SSO user with no email on file → 409
 *  - adapter `throttled` → 429 with `Retry-After` echo
 *  - adapter `upstreamFailure` → 502 with the Nexus reason in the body
 *  - adapter `notConfigured` → 503
 *  - per-session throttle: a second call within 60s → 429 without
 *    re-invoking the adapter
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import {
  buildContainer,
  setContainerForTests,
  type Container,
} from "@/composition/container";
import {
  InMemoryPasswordResetThrottle,
  RequestPasswordResetUseCase,
} from "@/features/auth/application/useCases";
import type {
  ForgotPasswordOutcome,
  PasswordResetClient,
} from "@/features/auth/domain/ports";

let baseUrl: string;
let close: () => Promise<void>;

const SSO_USERNAME = "vitest-pwreset-sso";
const LOCAL_USERNAME = "vitest-pwreset-local";

let ssoCookie: string;
let localCookie: string;
let ssoUserId: string;

// Adapter state that each test mutates between runs.
let sendCalls: string[] = [];
let nextOutcome: ForgotPasswordOutcome = { kind: "ok" };
let throttleNow = 1_000_000;

function installFakeContainer(): void {
  const real = buildContainer();
  const fakeClient: PasswordResetClient = {
    sendResetEmail: async (email: string) => {
      sendCalls.push(email);
      return nextOutcome;
    },
  };
  const useCase = new RequestPasswordResetUseCase(
    fakeClient,
    new InMemoryPasswordResetThrottle(60_000, () => throttleNow),
  );
  const next: Container = {
    ...real,
    useCases: {
      ...real.useCases,
      auth: {
        ...real.useCases.auth,
        requestPasswordReset: useCase,
      },
    },
  };
  setContainerForTests(next);
}

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());

  // SSO user — provisioned with a passwordHash so we can sign in via
  // /auth/login, then pinned to authSource='oidc' + a real email so the
  // route sees them as an SSO account.
  await provisionUser({
    username: SSO_USERNAME,
    role: "limited",
    email: "sso-user@example.com",
  });
  await db
    .update(usersTable)
    .set({ authSource: "oidc", email: "sso-user@example.com" })
    .where(eq(usersTable.username, SSO_USERNAME));
  const [ssoRow] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, SSO_USERNAME));
  ssoUserId = ssoRow!.id;
  ssoCookie = await login(baseUrl, SSO_USERNAME);

  // Local user — default authSource='local'.
  await provisionUser({ username: LOCAL_USERNAME, role: "limited" });
  localCookie = await login(baseUrl, LOCAL_USERNAME);

  installFakeContainer();
});

afterAll(async () => {
  setContainerForTests(null);
  await deleteUserByUsername(SSO_USERNAME);
  await deleteUserByUsername(LOCAL_USERNAME);
  await close();
});

beforeEach(() => {
  sendCalls = [];
  nextOutcome = { kind: "ok" };
  // Advance the clock past the throttle window so each test starts fresh.
  throttleNow += 120_000;
});

async function callPasswordReset(cookie?: string): Promise<Response> {
  return await fetch(`${baseUrl}/api/auth/password-reset`, {
    method: "POST",
    headers: withCookie(cookie ?? "", { "content-type": "application/json" }),
  });
}

describe("POST /api/auth/password-reset", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await callPasswordReset();
    expect(res.status).toBe(401);
    expect(sendCalls).toHaveLength(0);
  });

  it("returns 200 {} on happy path and calls the adapter with the SSO user's email", async () => {
    nextOutcome = { kind: "ok" };
    const res = await callPasswordReset(ssoCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(sendCalls).toEqual(["sso-user@example.com"]);
  });

  it("returns 409 for local username/password accounts and never calls the adapter", async () => {
    const res = await callPasswordReset(localCookie);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/local/i);
    expect(sendCalls).toHaveLength(0);
  });

  it("returns 409 when the SSO user has no email on file", async () => {
    await db
      .update(usersTable)
      .set({ email: null })
      .where(eq(usersTable.id, ssoUserId));
    try {
      const res = await callPasswordReset(ssoCookie);
      expect(res.status).toBe(409);
      expect(sendCalls).toHaveLength(0);
    } finally {
      await db
        .update(usersTable)
        .set({ email: "sso-user@example.com" })
        .where(eq(usersTable.id, ssoUserId));
    }
  });

  it("passes Nexus throttle through as 429 with Retry-After echoed", async () => {
    nextOutcome = {
      kind: "throttled",
      retryAfterSeconds: 30,
      message: "slow down",
    };
    const res = await callPasswordReset(ssoCookie);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    const body = (await res.json()) as {
      error: string;
      retryAfterSeconds: number;
    };
    expect(body.retryAfterSeconds).toBe(30);
    expect(body.error).toMatch(/slow down/);
  });

  it("returns 502 with the Nexus reason on upstreamFailure (5xx / network)", async () => {
    nextOutcome = {
      kind: "upstreamFailure",
      reason: "Nexus 503: boom",
    };
    const res = await callPasswordReset(ssoCookie);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Nexus 503: boom");
  });

  it("returns 503 when Nexus is not configured", async () => {
    nextOutcome = {
      kind: "notConfigured",
      message: "Password reset is not configured on this server.",
    };
    const res = await callPasswordReset(ssoCookie);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not configured/i);
  });

  it("throttles repeated calls per-session/user (60s) with 429 and does not re-call the adapter", async () => {
    nextOutcome = { kind: "ok" };
    const first = await callPasswordReset(ssoCookie);
    expect(first.status).toBe(200);
    expect(sendCalls).toHaveLength(1);

    // Advance only 5s — still inside the 60s window.
    throttleNow += 5_000;
    const second = await callPasswordReset(ssoCookie);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    expect(sendCalls).toHaveLength(1);
  });
});

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  emailTriggerRateLimit,
  guestRateLimit,
  loginRateLimit,
  rateLimit,
  resetRateLimitsForTests,
  setRateLimitEnabledForTests,
} from "@/shared/middlewares/rateLimit";

/**
 * Authentication rate limiting (audit finding H-3).
 *
 * The regression these tests exist for: `POST /api/auth/login` ran a
 * bcrypt comparison with no attempt counter, no lockout and no throttle.
 * That made credential brute force free, and — because bcrypt at cost 12
 * is ~100 ms of CPU by design on a 1-shared-CPU machine — made
 * unauthenticated CPU exhaustion free too.
 *
 * Tested against the middleware mounted on a throwaway Express app
 * rather than through the real `/api/auth/*` routes, deliberately. An
 * earlier version drove the live endpoints and had two problems: it
 * needed real bcrypt work per attempt (slow), and hammering
 * `POST /auth/guest` minted real guest sessions, which exhausted the
 * deployment-wide guest slot cap and broke `guestSessionService.test.ts`
 * in a completely unrelated file. The limiter's contract is
 * "N requests per key per window", which needs no database to verify.
 *
 * Wiring (that these limiters are actually attached to the real routes)
 * is covered by reading the route definitions; what can go subtly wrong
 * is the counting, and that is what is pinned here.
 */

const servers: Array<() => void> = [];

afterAll(() => {
  for (const closeFn of servers) closeFn();
  setRateLimitEnabledForTests(false);
});

/** Mount a middleware chain on an ephemeral server and return its URL. */
async function serve(
  ...middlewares: express.RequestHandler[]
): Promise<string> {
  const app: Express = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  for (const mw of middlewares) app.use(mw);
  app.all(/.*/, (_req, res) => res.status(200).json({ ok: true }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  servers.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function post(
  url: string,
  body: unknown = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetRateLimitsForTests();
  // Limiting is off by default under NODE_ENV=test so the process-global
  // counters don't make unrelated route-test files fail depending on
  // execution order. This file is the one that wants it on.
  setRateLimitEnabledForTests(true);
});

describe("rateLimit — counting", () => {
  it("allows exactly `max` requests per window, then 429s", async () => {
    const url = await serve(
      rateLimit({ windowMs: 60_000, max: 3, keys: () => ["fixed"] }),
    );

    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(429);
  });

  it("sends Retry-After and a machine-readable code with the 429", async () => {
    const url = await serve(
      rateLimit({ windowMs: 60_000, max: 1, keys: () => ["retry"] }),
    );
    await post(url);
    const limited = await post(url);

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await limited.json()) as {
      code?: string;
      retryAfter?: number;
    };
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it("keeps separate budgets for separate keys", async () => {
    const url = await serve(
      rateLimit({
        windowMs: 60_000,
        max: 1,
        keys: (req) => [`k:${(req.body as { k?: string }).k ?? ""}`],
      }),
    );

    expect((await post(url, { k: "a" })).status).toBe(200);
    expect((await post(url, { k: "a" })).status).toBe(429);
    // A different key is untouched by the first one's spent budget.
    expect((await post(url, { k: "b" })).status).toBe(200);
  });

  it("charges every key returned, so the tightest budget wins", async () => {
    const url = await serve(
      rateLimit({ windowMs: 60_000, max: 2, keys: () => ["shared", "also"] }),
    );
    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(429);
  });

  it("skips limiting when the key function returns nothing", async () => {
    const url = await serve(
      rateLimit({ windowMs: 60_000, max: 1, keys: () => [] }),
    );
    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(200);
  });

  it("does not limit at all when disabled", async () => {
    const url = await serve(
      rateLimit({ windowMs: 60_000, max: 1, keys: () => ["off"] }),
    );
    setRateLimitEnabledForTests(false);
    expect((await post(url)).status).toBe(200);
    expect((await post(url)).status).toBe(200);
  });

  it("starts a fresh budget once counters are cleared (window rollover)", async () => {
    const url = await serve(
      rateLimit({ windowMs: 60_000, max: 1, keys: () => ["roll"] }),
    );
    await post(url);
    expect((await post(url)).status).toBe(429);

    resetRateLimitsForTests();
    setRateLimitEnabledForTests(true);
    expect((await post(url)).status).toBe(200);
  });
});

describe("loginRateLimit — per-username vs per-IP", () => {
  it("limits one account without locking out other accounts from the same IP", async () => {
    // The per-username bucket (10/window) is the anti-brute-force
    // control. The per-IP bucket (60/window) is only a CPU guard, and
    // must stay loose enough that a shared office/VPN egress IP keeps
    // working — a tight per-IP budget would lock out every colleague to
    // stop an attack the attacker defeats by rotating IPs.
    const url = await serve(...loginRateLimit);

    let victimLimited = false;
    for (let i = 0; i < 12; i++) {
      const res = await post(url, { username: "victim" });
      if (res.status === 429) {
        victimLimited = true;
        break;
      }
    }
    expect(victimLimited).toBe(true);

    const bystander = await post(url, { username: "bystander" });
    expect(bystander.status).toBe(200);
  });

  it("treats usernames case- and whitespace-insensitively", async () => {
    const url = await serve(...loginRateLimit);
    for (let i = 0; i < 12; i++) {
      const res = await post(url, { username: "Casey" });
      if (res.status === 429) break;
    }
    // Same account spelled differently must not get a fresh budget.
    const res = await post(url, { username: "  casey  " });
    expect(res.status).toBe(429);
  });

  it("still limits per-IP when no username is supplied", async () => {
    const url = await serve(...loginRateLimit);
    let limited = false;
    for (let i = 0; i < 70; i++) {
      const res = await post(url, {});
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});

describe("guest and email-trigger limiters", () => {
  it("caps guest sign-ins per IP", async () => {
    const url = await serve(guestRateLimit);
    let limited = false;
    for (let i = 0; i < 10; i++) {
      const res = await post(url);
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    // Guest sign-in mints a DB row and a workspace directory against a
    // deployment-wide cap, so its budget is tighter than login's.
    expect(limited).toBe(true);
  });

  it("caps endpoints that trigger outbound email per IP", async () => {
    const url = await serve(emailTriggerRateLimit);
    let limited = false;
    for (let i = 0; i < 10; i++) {
      const res = await post(url, { email: "someone@example.com" });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});

import { type Request, type Response, type NextFunction } from "express";

/**
 * Fixed-window rate limiting for authentication endpoints (audit
 * finding H-3).
 *
 * `POST /api/auth/login` ran a bcrypt comparison with no attempt
 * counter, no lockout, and no throttle. Three consequences:
 *
 *  - Credential brute force / stuffing. The four demo usernames were
 *    known from the repository (see C-1), so discovering which still
 *    held the default password cost an attacker nothing.
 *  - CPU exhaustion. bcrypt at cost 12 is ~100 ms of CPU *by design*,
 *    and this deployment runs on **1 shared CPU / 1 GB** (fly.toml). A
 *    handful of concurrent attackers saturates the core and the whole
 *    app — API, SPA, and recorder — goes unavailable. Unauthenticated
 *    denial of service for the price of a loop.
 *  - Guest slot exhaustion: `POST /auth/guest` is unauthenticated and
 *    mints DB rows plus a workspace directory against a deployment-wide
 *    cap.
 *
 * Implemented in-process rather than with a Redis/store-backed library.
 * The deployment is single-instance by construction — the recording
 * session is a module-level singleton (see M-1), so a second machine
 * would already break the product — which makes a shared store
 * unnecessary today. If this ever scales out, the counters must move to
 * the session store's Postgres, and this comment is the marker for it.
 *
 * Memory safety matters here: an unbounded map keyed by client IP is
 * itself a memory-exhaustion vector, which would be an ironic way to
 * fix a DoS. Buckets are swept on a schedule and the map is hard-capped.
 */

interface Bucket {
  /** Attempt count inside the current window. */
  count: number;
  /** Epoch ms when the current window ends. */
  resetAt: number;
}

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Attempts permitted per key per window. */
  max: number;
  /**
   * Derive the bucket key(s) for a request. Returning several keys
   * charges the attempt against each, so login can be limited per-IP
   * *and* per-username at once. Return an empty array to skip.
   */
  keys: (req: Request) => string[];
  /** Message returned with the 429. */
  message?: string;
}

/**
 * Hard cap on tracked buckets. Past this, the sweeper drops the entries
 * closest to expiry. A legitimate deployment tracks a handful; a flood
 * hits the cap and simply gets coarser accounting, never unbounded
 * growth.
 */
const MAX_BUCKETS = 20_000;
const SWEEP_INTERVAL_MS = 60_000;

const buckets = new Map<string, Bucket>();

let sweeper: NodeJS.Timeout | null = null;

function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    if (buckets.size > MAX_BUCKETS) {
      // Evict soonest-to-expire first: they cost the least to lose.
      const ordered = [...buckets.entries()].sort(
        (a, b) => a[1].resetAt - b[1].resetAt,
      );
      const excess = buckets.size - MAX_BUCKETS;
      for (let i = 0; i < excess; i++) buckets.delete(ordered[i]![0]);
    }
  }, SWEEP_INTERVAL_MS);
  // Never hold the process open for the sweeper.
  sweeper.unref?.();
}

/**
 * Consume one attempt for `key`. Returns the retry delay in seconds when
 * the key is over budget, or `null` when the attempt is allowed.
 */
function consume(key: string, opts: RateLimitOptions): number | null {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return null;
  }
  existing.count += 1;
  if (existing.count > opts.max) {
    return Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  }
  return null;
}

/**
 * Client IP for limiting. `app.set("trust proxy", 1)` is configured, so
 * `req.ip` is the Fly-supplied client address rather than the internal
 * proxy hop — which is what makes per-IP limiting meaningful rather than
 * lumping every request into one bucket.
 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function rateLimit(opts: RateLimitOptions) {
  ensureSweeper();
  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!enabled) {
      next();
      return;
    }
    const keys = opts.keys(req);
    if (keys.length === 0) {
      next();
      return;
    }

    let worstRetry: number | null = null;
    for (const key of keys) {
      const retry = consume(key, opts);
      if (retry !== null && (worstRetry === null || retry > worstRetry)) {
        worstRetry = retry;
      }
    }

    if (worstRetry === null) {
      next();
      return;
    }

    req.log?.warn(
      { path: req.path, ip: clientIp(req), retryAfter: worstRetry },
      "rate limit exceeded",
    );
    res.setHeader("Retry-After", String(worstRetry));
    res.status(429).json({
      error:
        opts.message ??
        "Too many requests. Please wait before trying again.",
      code: "RATE_LIMITED",
      retryAfter: worstRetry,
    });
  };
}

/** Test seam — drop all counters so cases don't leak into each other. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
}

/**
 * Whether limiting is active.
 *
 * Off under `NODE_ENV=test` (which vitest sets) because these counters
 * are process-global and the suite is not: dozens of route test files
 * sign in repeatedly from 127.0.0.1, so a shared budget makes unrelated
 * files fail depending on execution order — which is exactly what
 * happened when this was unconditional. Rate limiting is infrastructure
 * the rest of the suite should not have to fight.
 *
 * `rateLimit.test.ts` turns it back on for itself via
 * {@link setRateLimitEnabledForTests}, so the behavior is still covered.
 */
let enabled = process.env.NODE_ENV !== "test";

/** Test seam — enable/disable limiting for one test file. */
export function setRateLimitEnabledForTests(value: boolean): void {
  enabled = value;
  buckets.clear();
}

// --- Concrete policies -----------------------------------------------

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Login. The two buckets do different jobs, and conflating them is a
 * mistake worth spelling out.
 *
 * The **per-username** bucket is the anti-brute-force control: it is what
 * stops an attacker grinding one account, and it holds no matter how many
 * IPs they spread across. It is therefore the tight one.
 *
 * The **per-IP** bucket is a CPU guard, not an identity control. bcrypt at
 * cost 12 is ~100 ms on a shared core, so the job is to bound total work
 * from one source. It must stay loose enough for a legitimate shared
 * egress IP — an office or VPN behind one NAT is many people signing in
 * from a single address, and a tight per-IP budget locks all of them out
 * of the product to stop an attack it does not actually stop (the
 * attacker just rotates IPs). 60 attempts / 15 min caps one address at
 * roughly 6 s of bcrypt CPU per window, which is negligible, while
 * leaving normal shared-IP usage well clear of the limit.
 *
 * Deliberately not a hard account lock: locking the account itself turns
 * a failed-login flood into a denial of service against the real user.
 */
const LOGIN_PER_IP_MAX = 60;
const LOGIN_PER_USERNAME_MAX = 10;

const loginPerUsername = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  max: LOGIN_PER_USERNAME_MAX,
  message:
    "Too many sign-in attempts for this account. Please wait a few minutes and try again.",
  keys: (req) => {
    const body = req.body as { username?: unknown } | undefined;
    const username =
      typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    return username ? [`login:user:${username}`] : [];
  },
});

const loginPerIp = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  max: LOGIN_PER_IP_MAX,
  message:
    "Too many sign-in attempts from this address. Please wait a few minutes and try again.",
  keys: (req) => [`login:ip:${clientIp(req)}`],
});

/** Both login limiters, in order. Mount as a single middleware array. */
export const loginRateLimit = [loginPerUsername, loginPerIp] as const;

/**
 * Guest sign-in: unauthenticated and resource-minting (a DB row plus a
 * workspace directory against a deployment-wide cap), so it gets a
 * tighter per-IP budget than login.
 */
export const guestRateLimit = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  max: 5,
  message:
    "Too many guest sessions started from this address. Please wait a few minutes.",
  keys: (req) => [`guest:ip:${clientIp(req)}`],
});

/**
 * Password reset and SSO access requests both trigger outbound email via
 * a third party, so an unthrottled endpoint is both a spam vector aimed
 * at real inboxes and a way to burn the email provider's quota.
 */
export const emailTriggerRateLimit = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  max: 5,
  message:
    "Too many requests. Please wait a few minutes before trying again.",
  keys: (req) => [`email:ip:${clientIp(req)}`],
});

import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import app from "@/app";
import { db, usersTable, type User, type UserRole } from "@workspace/db";
import { setAuthProvider } from "@/features/auth/infrastructure/authProvider";
import { hashPassword } from "@/features/auth/infrastructure/passwordHash";
import { resetCurrentProjectsForTests } from "@/features/projects/infrastructure/projectService";
import { resetRateLimitsForTests } from "@/shared/middlewares/rateLimit";

export const DEFAULT_PASSWORD = "Sup3rSecret!";

/**
 * Boot the express app on an ephemeral port and return a baseUrl + close
 * helper. Each test suite creates and tears down its own server so the
 * tests can run in any order without sharing port state.
 */
export async function bootServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  // Reset the cached auth provider so getAuthProvider() returns the
  // default local one (the same one auth.routes.test.ts assumes).
  setAuthProvider(null);
  // Wipe the per-user current-project map so a fresh test file never
  // observes a stale entry written by a prior file that happens to
  // share this worker process. See task #44.
  resetCurrentProjectsForTests();
  // Auth rate limits are process-global; a fresh test server must not
  // inherit counters spent by a sibling test file (they all sign in from
  // 127.0.0.1). Production never calls this.
  resetRateLimitsForTests();
  // The session middleware ships with `cookie.secure: true` (correct for
  // production), which causes express-session to suppress the Set-Cookie
  // header when the request isn't perceived as HTTPS. Tests reach the
  // app over loopback HTTP, so without this shim every `login()` call
  // returns 200 with no cookie and downstream auth-aware tests can't
  // authenticate. The app already calls `app.set("trust proxy", 1)`, so
  // injecting `x-forwarded-proto: https` is enough to make `req.secure`
  // true for these synthetic requests.
  const server = http.createServer((req, res) => {
    req.headers["x-forwarded-proto"] = "https";
    (app as unknown as (r: typeof req, s: typeof res) => void)(req, res);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    server,
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Insert a user with the given role and a known password hash. */
export async function provisionUser(args: {
  username: string;
  role: UserRole;
  password?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  email?: string;
}): Promise<User> {
  const passwordHash = await hashPassword(args.password ?? DEFAULT_PASSWORD);
  // Be idempotent — re-running a test file shouldn't blow up on the unique
  // username constraint left over from a previous failed run.
  await db.delete(usersTable).where(eq(usersTable.username, args.username));
  const [created] = await db
    .insert(usersTable)
    .values({
      username: args.username,
      passwordHash,
      role: args.role,
      firstName: args.firstName ?? null,
      lastName: args.lastName ?? null,
      title: args.title ?? null,
      email: args.email ?? null,
      profile: {},
    })
    .returning();
  if (!created) throw new Error(`Failed to create user '${args.username}'`);
  return created;
}

export async function deleteUserByUsername(username: string): Promise<void> {
  await db.delete(usersTable).where(eq(usersTable.username, username));
}

/**
 * Login via the public /api/auth/login route and return the cookie header
 * value (just `name=value`, no flags) suitable for re-sending on later
 * fetches.
 */
export async function login(
  baseUrl: string,
  username: string,
  password: string = DEFAULT_PASSWORD,
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) {
    throw new Error(
      `login(${username}) failed: ${res.status} ${await res.text()}`,
    );
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error(`login(${username}) returned no cookie`);
  return setCookie.split(";")[0]!;
}

/** Build headers with Cookie and optional extras. */
export function withCookie(
  cookie: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return cookie ? { ...extra, cookie } : { ...extra };
}

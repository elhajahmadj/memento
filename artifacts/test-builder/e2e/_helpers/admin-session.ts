import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Shared boot helpers for E2E specs that need an authenticated
 * session against the live api-server + test-builder workflows.
 *
 * Three pieces every session-aware spec needs:
 *   1. `FORWARDED_HTTPS_HEADER` — the api-server's session cookie is
 *      `secure: true`, so express-session only emits `Set-Cookie`
 *      when `req.secure` is true. The server sets `trust proxy`, so
 *      forwarding `X-Forwarded-Proto: https` makes the dev-login
 *      cookie stick on Playwright's HTTP request/page contexts
 *      (the shared proxy at localhost:80 doesn't add it on its own).
 *      Apply with `test.use({ extraHTTPHeaders: FORWARDED_HTTPS_HEADER })`.
 *   2. `devLogin()` — hits `/api/auth/dev-login` (gated by
 *      `APP_ENVIRONMENT=development` on the api-server) with the
 *      current `email=`/`role=` signature. `role=user` is no longer
 *      a valid enum; non-admin callers use `"limited"`.
 *   3. `completeProfile()` — fresh dev-login users have
 *      `profileComplete: false`, which causes the SPA to redirect
 *      any deep link (e.g. `/admin`) to `/profile/complete`. UI-driven
 *      tests need to fill the profile through the API first so page
 *      navigation lands on the intended route.
 */

export const FORWARDED_HTTPS_HEADER = {
  "X-Forwarded-Proto": "https",
} as const;

export type DevLoginRole = "admin" | "limited_admin" | "limited";

type RequestSource = APIRequestContext | Page | { request: APIRequestContext };

function resolveRequest(source: RequestSource): APIRequestContext {
  if ("request" in source && source.request !== undefined) {
    return source.request;
  }
  return source as APIRequestContext;
}

export function devLoginEmail(username: string): string {
  return username.includes("@") ? username : `${username}@example.com`;
}

export async function devLogin(
  source: RequestSource,
  base: string,
  username: string,
  role: DevLoginRole,
): Promise<void> {
  const request = resolveRequest(source);
  const email = devLoginEmail(username);
  const res = await request.get(
    `${base}/api/auth/dev-login?email=${encodeURIComponent(email)}&role=${role}`,
  );
  expect(
    res.ok(),
    `dev-login(${email},${role}) failed: ${res.status()} (is APP_ENVIRONMENT=development on the api-server?)`,
  ).toBeTruthy();
}

export interface CompleteProfileOptions {
  firstName?: string;
  lastName?: string;
  title?: string;
}

export async function completeProfile(
  source: RequestSource,
  base: string,
  username: string,
  options: CompleteProfileOptions = {},
): Promise<void> {
  const request = resolveRequest(source);
  const email = devLoginEmail(username);
  const res = await request.put(`${base}/api/auth/profile`, {
    data: {
      firstName: options.firstName ?? "E2E",
      lastName: options.lastName ?? "Admin",
      title: options.title ?? "QA",
      email,
    },
  });
  expect(
    res.ok(),
    `profile update failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
}

/**
 * Dev-login + complete-profile + dismiss the onboarding tour in one
 * call. Used by specs that drive the SPA UI and don't want the tour
 * overlay covering their interactions.
 */
export async function seedAdminSession(
  source: RequestSource,
  base: string,
  username = "admin",
): Promise<void> {
  const request = resolveRequest(source);
  await devLogin(request, base, username, "admin");
  await completeProfile(request, base, username);
  await request.post(`${base}/api/users/me/tour-seen`, {
    data: { hasSeenTour: true },
  });
}

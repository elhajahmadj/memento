import type { AuthUser } from "@workspace/api-client-react";

/**
 * Helpers for the guest ("Continue as guest") trial identity: pure
 * deadline math plus the one network call that starts a session.
 */

/**
 * Thrown by {@link startGuestSession} when the deployment-wide guest
 * cap is full. A distinct class (rather than a status code the caller
 * has to sniff) keeps the login UI's error handling readable.
 */
export class GuestCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestCapacityError";
  }
}

/**
 * Mint a throwaway guest identity via `POST /api/auth/guest`.
 *
 * Uses `fetch` rather than the generated client because the endpoint is
 * unauthenticated and needs bespoke handling of the 429 capacity
 * response — the same reason the login page's SSO admin-contacts and
 * request-access calls are plain fetches.
 */
export async function startGuestSession(): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/auth/guest`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (res.status === 429) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new GuestCapacityError(
      body?.error ??
        "Max guest sessions in use for the day. Please try again later.",
    );
  }
  if (!res.ok) {
    throw new Error("Couldn't start a guest session. Please try again.");
  }
}

/**
 * Read the guest hard-delete deadline off an auth user.
 *
 * `guestExpiresAt` is declared on `AuthUser` in `openapi.yaml`, but the
 * generated client is only refreshed when someone runs
 * `pnpm --filter @workspace/api-spec run codegen`. Reading it through a
 * widened structural type keeps this module compiling against both the
 * pre- and post-codegen shape, and returns null for any account that
 * simply isn't a guest.
 */
export function guestExpiresAt(user: AuthUser | null): Date | null {
  if (!user) return null;
  const raw = (user as AuthUser & { guestExpiresAt?: string | null })
    .guestExpiresAt;
  if (typeof raw !== "string" || raw === "") return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Milliseconds until a guest session is destroyed, clamped at zero.
 * Returns null when there is no deadline (i.e. not a guest).
 */
export function guestMsRemaining(
  user: AuthUser | null,
  now: number = Date.now(),
): number | null {
  const expiry = guestExpiresAt(user);
  if (!expiry) return null;
  return Math.max(0, expiry.getTime() - now);
}

/**
 * Render a remaining-time span as a compact, human label — "5h 42m",
 * "42m", "< 1m". Deliberately coarse: a ticking seconds counter on a
 * 6-hour window is noise, and it would force a 1s re-render loop.
 */
export function formatGuestRemaining(msRemaining: number): string {
  const totalMinutes = Math.floor(msRemaining / 60_000);
  if (totalMinutes < 1) return "< 1m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

import type { AuthUserRole } from "@workspace/api-client-react";

/**
 * Pure role/permission rules for the auth feature. No React, no I/O —
 * this module is the single source of truth for "who is allowed to see
 * what". Both the React role hooks/guards in `presentation/role.tsx`
 * AND the documentation matrix (`src/lib/docs/matrix.ts`) derive their
 * visibility rules from this file, so a change here automatically flows
 * to gate UI, doc sidebar entries, and the auto-permissions note.
 */

export type { AuthUserRole };

/**
 * All known auth roles, ordered from highest privilege to lowest.
 * Memento Admin is memento's god-mode super role; `limited` is the
 * default end-user role; `guest` is the throwaway trial identity minted
 * by "Continue as guest".
 *
 * Note this list also drives the documentation matrix
 * (`src/lib/docs/matrix.ts`) and the generated
 * `docs/role-page-matrix.md`, so adding a role here means deciding
 * which documented sections it can reach.
 */
export const ALL_ROLES: readonly AuthUserRole[] = [
  "memento_admin",
  "admin",
  "limited_admin",
  "limited",
  "guest",
] as const;

/**
 * Numeric rank used to compare two roles. Higher = more privilege.
 * Unknown / unauthenticated roles rank `-1`.
 */
export function roleRank(role: AuthUserRole | null): number {
  if (role === null) return -1;
  const idx = ALL_ROLES.indexOf(role);
  if (idx === -1) return -1;
  return ALL_ROLES.length - 1 - idx;
}

/**
 * True when `role` is at least as privileged as `minimum`. Used as the
 * primitive behind every "X or higher" permission check.
 */
export function roleSatisfies(
  role: AuthUserRole | null,
  minimum: AuthUserRole,
): boolean {
  return roleRank(role) >= roleRank(minimum);
}

export type RolePredicate = (role: AuthUserRole | null) => boolean;

/**
 * Permission predicates. Each predicate is a pure function from "what
 * role does this user have" to "are they allowed". Keep these in lock-
 * step with the React hooks that consume them (see
 * `presentation/role.tsx`).
 */
export const ROLE_PREDICATES = {
  /** Any signed-in role. */
  any: (role: AuthUserRole | null): boolean => role !== null,
  /**
   * Strict admin or higher (matches `useIsAdmin`). Memento Admin is a
   * god-mode superset of Admin and satisfies every Admin-only gate.
   */
  admin: (role: AuthUserRole | null): boolean =>
    role === "admin" || role === "memento_admin",
  /** Either flavour of admin (matches `useIsAnyAdmin`). */
  anyAdmin: (role: AuthUserRole | null): boolean =>
    role === "admin" ||
    role === "limited_admin" ||
    role === "memento_admin",
  /** Limited admin only (matches `useIsLimitedAdmin`). */
  limitedAdmin: (role: AuthUserRole | null): boolean =>
    role === "limited_admin",
  /** Memento Admin only (matches `useIsMementoAdmin`). */
  mementoAdmin: (role: AuthUserRole | null): boolean =>
    role === "memento_admin",
  /** Limited (User) role only — used for user-only routes. */
  limitedUser: (role: AuthUserRole | null): boolean => role === "limited",
  /**
   * Throwaway guest trial identity. Use to HIDE things guests can't
   * have (AI affordances, setup surfaces) rather than to grant
   * anything — the server-side allow-list in
   * `shared/middlewares/guestAllowlist.ts` is the actual enforcement.
   */
  guest: (role: AuthUserRole | null): boolean => role === "guest",
  /**
   * Any signed-in role that is NOT a guest. This is the predicate to
   * reach for when gating a feature that a real account should have
   * but a trial identity should not.
   */
  nonGuest: (role: AuthUserRole | null): boolean =>
    role !== null && role !== "guest",
} as const;

/** Concrete list of roles that satisfy a predicate. */
export function rolesMatching(predicate: RolePredicate): AuthUserRole[] {
  return ALL_ROLES.filter((r) => predicate(r));
}

/**
 * Normalize a free-form role string (e.g. an IDP claim value) into the
 * canonical `AuthUserRole` value. Matching is case- and whitespace-
 * insensitive and accepts both the display names (`"Memento Admin"`,
 * `"Limited Admin"`, `"User"`) and the canonical ids
 * (`"memento_admin"`, `"limited_admin"`, `"limited"`). Anything
 * unrecognised returns `null`.
 */
export function normalizeRoleName(value: string | null | undefined): AuthUserRole | null {
  if (value == null) return null;
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  switch (key) {
    case "mementoadmin":
      return "memento_admin";
    case "admin":
      return "admin";
    case "limitedadmin":
      return "limited_admin";
    case "user":
    case "limited":
    case "limiteduser":
      return "limited";
    // `guest` is deliberately absent: it is minted only by the
    // "Continue as guest" endpoint and must never be assignable from
    // an IDP claim or an admin-entered role string.
    default:
      return null;
  }
}

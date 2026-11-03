/**
 * Resolve the *effective* memento role for an authenticated request.
 *
 * Per-org roles foundation (task #35): a user's authority depends on
 * which org they're acting in, not just on a single global column.
 * Precedence (highest wins):
 *
 *  1. `memento_admin` — god-mode super role, org-independent.
 *     Always wins regardless of `activeOrgId`.
 *  2. Local username/password users — keep the pre-org global view;
 *     their effective role is whatever lives on `users.role`. Per-org
 *     roles do not apply to local users (they have no
 *     `user_organizations` rows).
 *  3. SSO users — effective role is the `user_organizations.role`
 *     for the (userId, activeOrgId) pair. When `activeOrgId` is null
 *     or no matching membership row exists *but the user still has
 *     other memberships*, returns `null` so the caller can treat the
 *     request as forbidden / re-prompt for an org pick.
 *  4. SSO users with **zero** memberships — the IDP has revoked every
 *     org, so there is nothing to pick from. Fall back to `users.role`
 *     so role gates still admit the request; downstream scope policy
 *     resolves to "none" and the route returns an empty list rather
 *     than 403 (a 403 would hide that the user is otherwise authorized
 *     and would falsely look like a missing-active-org prompt).
 *
 * This helper is the single source of truth for "what role does this
 * request run with?". Read sites (route guards, middleware, the
 * Settings UI gating, etc.) will be migrated to call it in the
 * follow-up task; today it backs `/auth/me` so the SPA can already
 * surface per-org awareness.
 */
import { eq } from "drizzle-orm";
import { db, userOrganizationsTable, type User } from "@workspace/db";
import type { MementoRole } from "./claims";

export type EffectiveRole = MementoRole;

export function isLocalUser(user: Pick<User, "authSource">): boolean {
  return user.authSource !== "oidc";
}

/**
 * Pure (no IO) variant that takes the membership rows already loaded
 * by the caller. Useful for endpoints like `/auth/me` that need the
 * full membership list anyway and want to avoid a second round-trip.
 */
export function resolveEffectiveRoleFromMemberships(
  user: Pick<User, "role" | "authSource">,
  activeOrgId: string | null,
  memberships: Array<{
    organizationId: string;
    role: "admin" | "limited_admin" | "limited";
  }>,
): EffectiveRole | null {
  if (user.role === "memento_admin") return "memento_admin";
  if (isLocalUser(user)) return user.role;
  // SSO user with zero memberships at all: nothing to pick from, so
  // fall back to `users.role` (see header §4). Scope policy still
  // resolves to "none" downstream, so the user authorizes but sees
  // no projects.
  if (memberships.length === 0) return user.role;
  if (!activeOrgId) return null;
  const membership = memberships.find((m) => m.organizationId === activeOrgId);
  return membership ? membership.role : null;
}

/**
 * IO variant. Looks up the user's role on the requested org from the
 * database when needed. Memento Admins and local users short-circuit
 * without touching the DB.
 */
export async function resolveEffectiveRole(
  user: Pick<User, "id" | "role" | "authSource">,
  activeOrgId: string | null,
): Promise<EffectiveRole | null> {
  if (user.role === "memento_admin") return "memento_admin";
  if (isLocalUser(user)) return user.role;
  // Fetch every membership so we can distinguish "no memberships at
  // all" (fall back to users.role — see header §4) from "memberships
  // exist but activeOrgId doesn't match one" (return null so the
  // caller re-prompts for an org pick).
  const rows = await db
    .select({
      organizationId: userOrganizationsTable.organizationId,
      role: userOrganizationsTable.role,
    })
    .from(userOrganizationsTable)
    .where(eq(userOrganizationsTable.userId, user.id));
  if (rows.length === 0) return user.role;
  if (!activeOrgId) return null;
  const match = rows.find((r) => r.organizationId === activeOrgId);
  return match?.role ?? null;
}

import { and, eq } from "drizzle-orm";
import { type Request } from "express";
import {
  db,
  userOrganizationsTable,
  type User,
} from "@workspace/db";
import { resolveScopePolicy } from "@/features/auth/infrastructure/orgScope";
import { getEffectiveRole } from "@/shared/middlewares/effectiveRole";

export interface SoleOrgAdminResult {
  /**
   * True when the caller is the *only* user with role `admin` in their
   * active organization. Memento Admins do NOT count toward this rule
   * — they are a god-mode role that always provides an additional
   * approver path, so a "lone Admin" inside an org is still considered
   * the sole Admin even if a Memento Admin exists.
   */
  isSoleAdmin: boolean;
  /**
   * The org id used to compute the result. Null when the caller has no
   * active org (local users, or OIDC users with no org picked); in that
   * case `isSoleAdmin` is `false` and downstream flows should treat
   * "no org" as "no approval needed" to preserve pre-feature behavior.
   */
  orgId: string | null;
}

/**
 * Returns whether the given user is the only `admin`-role member of
 * their active organization. Used by the project lifecycle approval
 * flow to grant a sole-Admin override on otherwise gated actions.
 *
 * Counting rules:
 * - Only rows in `user_organizations` for the caller's active org are
 *   considered.
 * - Only memberships with `user_organizations.role = 'admin'` count
 *   — i.e. the user's per-org effective role. `memento_admin` cannot
 *   appear on a membership row (god-mode lives on `users.role`) and
 *   `limited_admin` / `limited` are excluded by the filter.
 * - Distinct user ids — duplicate membership rows do not inflate.
 * - For local users (no active org), returns `{ isSoleAdmin: false,
 *   orgId: null }`.
 */
export async function getSoleOrgAdminStatus(
  req: Request,
  user: Pick<User, "id" | "role" | "authSource">,
): Promise<SoleOrgAdminResult> {
  const policy = await resolveScopePolicy(req);
  if (policy.kind !== "org") {
    return { isSoleAdmin: false, orgId: null };
  }
  const orgId = policy.orgId;

  // Authorize on the *effective* (per-org) role — task #36. The
  // caller's authority in this org is what matters; `users.role`
  // alone is misleading for SSO users whose global column has been
  // demoted to `limited` since the per-org-roles foundation.
  const effective = await getEffectiveRole(req);
  if (effective !== "admin") {
    return { isSoleAdmin: false, orgId };
  }
  void user;

  const rows = await db
    .selectDistinct({ userId: userOrganizationsTable.userId })
    .from(userOrganizationsTable)
    .where(
      and(
        eq(userOrganizationsTable.organizationId, orgId),
        eq(userOrganizationsTable.role, "admin"),
      ),
    );

  const distinctAdminIds = new Set(rows.map((r) => r.userId));
  // The caller must themselves be counted; if they are an admin but
  // not yet a member of the org (shouldn't happen in practice, but
  // we're defensive), treat as not-sole.
  if (!distinctAdminIds.has(user.id)) {
    return { isSoleAdmin: false, orgId };
  }
  return { isSoleAdmin: distinctAdminIds.size === 1, orgId };
}

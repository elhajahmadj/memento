import { and, eq } from "drizzle-orm";
import { type Request } from "express";
import {
  db,
  userOrganizationsTable,
  usersTable,
  type User,
} from "@workspace/db";
import {
  getActiveOrgId,
  getProjectOrgId,
  resolveScopePolicy,
} from "@/features/auth/infrastructure/orgScope";
import { getEffectiveRole } from "@/shared/middlewares/effectiveRole";

export interface ApprovalContext {
  /**
   * `true` when the caller can perform the lifecycle action without
   * filing a pending approval request — because there is no other
   * Admin available to approve.
   *
   * - `admin`        → bypass when they are the sole Admin in scope.
   * - `memento_admin`→ bypass when there are zero Admins in scope
   *                    (god-mode covers absent approvers).
   * - `limited_admin`→ never bypasses; an Admin must approve.
   */
  bypass: boolean;
  /** Active org id, or null for local (policy "all") installs. */
  orgId: string | null;
}

async function countAdminsInOrg(orgId: string): Promise<number> {
  // Count by per-org effective role — task #36. After the per-org
  // roles foundation, SSO admins carry `users.role = 'limited'`
  // globally; the only correct admin signal for an org is the
  // membership's own role. `memento_admin` cannot appear here (the
  // per-org enum forbids it), which preserves the rule that god-mode
  // does NOT count as an in-org Admin for bypass purposes.
  const rows = await db
    .selectDistinct({ userId: userOrganizationsTable.userId })
    .from(userOrganizationsTable)
    .where(
      and(
        eq(userOrganizationsTable.organizationId, orgId),
        eq(userOrganizationsTable.role, "admin"),
      ),
    );
  return new Set(rows.map((r) => r.userId)).size;
}

async function countWorkspaceAdmins(): Promise<number> {
  const rows = await db
    .selectDistinct({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));
  return new Set(rows.map((r) => r.id)).size;
}

export async function getApprovalContext(
  req: Request,
  user: Pick<User, "id" | "role">,
  /**
   * Target project name. When provided, memento-admin bypass is
   * computed against the *project's* owning org (the only relevant
   * scope for "are there other admins who could approve this delete?"),
   * not whatever org happens to be active in the session.
   */
  projectName?: string,
): Promise<ApprovalContext> {
  // Memento Admin is god-mode: `resolveScopePolicy` always returns
  // `{kind:"all"}` for them, so we cannot derive the relevant org from
  // it. Use the *project's* org when we have one; fall back to the
  // session's active org, then to workspace-wide.
  // Authorize on the *effective* (per-org) role — task #36. SSO users
  // post-foundation carry `users.role = 'limited'` globally; only the
  // resolver returns their true authority for the active org. Memento
  // Admin still lives on `users.role` (god-mode, org-independent) and
  // is preserved by the resolver.
  const effective = (await getEffectiveRole(req)) ?? user.role;
  if (effective === "memento_admin") {
    let targetOrgId: string | null = null;
    if (projectName) {
      targetOrgId = await getProjectOrgId(projectName);
    }
    if (!targetOrgId) {
      targetOrgId = getActiveOrgId(req);
    }
    if (targetOrgId) {
      const adminsInOrg = await countAdminsInOrg(targetOrgId);
      return { bypass: adminsInOrg === 0, orgId: targetOrgId };
    }
    // No project org and no active org → workspace-wide scope. Bypass
    // when there are no Admins anywhere (e.g. fresh install with only
    // a Memento Admin).
    const total = await countWorkspaceAdmins();
    return { bypass: total === 0, orgId: null };
  }

  const policy = await resolveScopePolicy(req);
  const orgId = policy.kind === "org" ? policy.orgId : null;

  if (effective === "limited_admin") {
    return { bypass: false, orgId };
  }
  if (effective === "admin") {
    const adminCount =
      policy.kind === "org"
        ? await countAdminsInOrg(policy.orgId)
        : await countWorkspaceAdmins();
    return { bypass: adminCount <= 1, orgId };
  }
  return { bypass: false, orgId };
}

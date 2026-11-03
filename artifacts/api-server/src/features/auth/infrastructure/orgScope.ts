import { eq, inArray } from "drizzle-orm";
import { type Request, type Response, type NextFunction } from "express";
import {
  db,
  projectOrganizationsTable,
  userOrganizationsTable,
  type User,
} from "@workspace/db";
import { findActiveGuestSession } from "@/features/guest/infrastructure/guestSessionService";

/**
 * Result of resolving the org-scoping policy for a request.
 *
 * - `kind: "all"` — the caller is a *local* user (`authSource = local`)
 *   or unauthenticated; pre-org behavior applies (sees every project).
 * - `kind: "org"` — the caller is an OIDC user with an active org;
 *   they only see projects stamped with that org. They never see
 *   unowned (local-user) projects.
 * - `kind: "none"` — the caller is an OIDC user without an active org
 *   (e.g. needs to pick one, or has been removed from every org by the
 *   IDP); they see nothing.
 * - `kind: "guest"` — the caller is a "Continue as guest" trial
 *   identity; they see exactly the one project bound to their
 *   `guest_sessions` row, and nothing else.
 */
export type ScopePolicy =
  | { kind: "all" }
  | { kind: "org"; orgId: string }
  | { kind: "guest"; projectName: string | null }
  | { kind: "none" };

/**
 * Compute the scoping policy for the current request. The `authSource`
 * column on `users` is the source of truth: only OIDC-provisioned users
 * are subject to org scoping. Local users (seeded, dev-login, or
 * username/password) keep the pre-org global view *regardless* of how
 * many `user_organizations` rows they happen to have — this is critical
 * because an OIDC user whose orgs were all revoked has zero memberships
 * and must NOT fall through to "global access".
 */
export async function resolveScopePolicy(req: Request): Promise<ScopePolicy> {
  const user = req.user;
  if (!user) return { kind: "all" };

  // Guests are checked FIRST and before the local-user short-circuit
  // below. A guest is not an OIDC user, so without this branch they
  // would fall through to `{ kind: "all" }` and see every project in
  // the workspace — including other tenants' work. Their visibility is
  // exactly the one project bound to their slot (null until they
  // create it, which correctly resolves to "sees nothing").
  if (user.role === "guest") {
    const guest = await findActiveGuestSession(user.id);
    return { kind: "guest", projectName: guest?.projectName ?? null };
  }

  // Memento Admin is a god-mode role that lives outside any single
  // organization and sees every project across every org. Resolves
  // to "all" regardless of authSource so an SSO-provisioned Memento
  // Admin still bypasses per-org filtering. The god-mode role lives
  // exclusively on `users.role` (never on `user_organizations.role`),
  // so reading `user.role` here is equivalent to consulting the
  // resolver and avoids a needless round-trip.
  if (user.role === "memento_admin") return { kind: "all" };

  // Local users are global by design — pre-org behavior preserved.
  if (user.authSource !== "oidc") return { kind: "all" };

  const memberships = await db
    .select()
    .from(userOrganizationsTable)
    .where(eq(userOrganizationsTable.userId, user.id));

  // OIDC user with no org memberships sees nothing. The IDP is the
  // authority — losing every org means losing all project access.
  if (memberships.length === 0) return { kind: "none" };

  // Bearer-token (sessionless) callers can pass an explicit
  // `X-Organization-Id` header to disambiguate when they belong to
  // more than one org. For single-org bearer users we auto-pick
  // their only membership so common machine-to-machine callers
  // don't need to know about org headers at all.
  const headerOrgRaw = req.header("x-organization-id");
  const headerOrg =
    typeof headerOrgRaw === "string" && headerOrgRaw.trim().length > 0
      ? headerOrgRaw.trim()
      : null;

  const activeOrgId =
    req.session.activeOrgId ??
    headerOrg ??
    (memberships.length === 1 ? memberships[0]!.organizationId : null);
  if (!activeOrgId) return { kind: "none" };

  // Defense in depth: an OIDC user can only "be active" in an org they
  // are still a member of. If a previously-active org was revoked in
  // the IDP and re-synced away on the next login, the session value
  // becomes invalid and we fall back to "none" so the UI can re-prompt.
  const stillMember = memberships.some((m) => m.organizationId === activeOrgId);
  if (!stillMember) return { kind: "none" };

  return { kind: "org", orgId: activeOrgId };
}

/**
 * Look up the org that owns a given project (by solution name), or
 * null if the project is unowned (created by a local user).
 */
export async function getProjectOrgId(
  projectName: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(projectOrganizationsTable)
    .where(eq(projectOrganizationsTable.projectName, projectName))
    .limit(1);
  return rows[0]?.organizationId ?? null;
}

/**
 * Decide whether the given project is visible under the resolved
 * policy. Cross-org access intentionally returns `false` so the
 * caller can respond with 404 (not 403) and keep org membership
 * unobservable.
 */
export async function canSeeProject(
  policy: ScopePolicy,
  projectName: string,
): Promise<boolean> {
  if (policy.kind === "none") return false;
  // Guests see one project and only one. Checked before the org lookup
  // because guest projects are never stamped into
  // `project_organizations` — there is no org to compare against.
  if (policy.kind === "guest") {
    return policy.projectName !== null && policy.projectName === projectName;
  }
  const orgId = await getProjectOrgId(projectName);
  if (policy.kind === "all") {
    // Local users see unowned + every owned project (pre-org behavior
    // for unowned, and admin-of-all behavior for owned). The task
    // explicitly preserves the local-user experience.
    return true;
  }
  // policy.kind === "org"
  return orgId === policy.orgId;
}

/**
 * The set of project names a policy restricts the caller to, or `null`
 * when the policy imposes no restriction ("all").
 *
 * Prefer this over hand-rolling `if (policy.kind === "org")` at a call
 * site. Those implicit-else branches are how the `guest` variant
 * originally slipped through in four places: an unhandled kind silently
 * fell into the *unrestricted* path (dashboard) or the *nothing-visible*
 * path (current/available), and TypeScript can't catch either because
 * the branch is an `if`, not an exhaustive `switch`.
 */
export async function scopedProjectNames(
  policy: ScopePolicy,
): Promise<string[] | null> {
  switch (policy.kind) {
    case "all":
      return null;
    case "none":
      return [];
    case "guest":
      return policy.projectName === null ? [] : [policy.projectName];
    case "org": {
      const rows = await db
        .select({ p: projectOrganizationsTable.projectName })
        .from(projectOrganizationsTable)
        .where(eq(projectOrganizationsTable.organizationId, policy.orgId));
      return rows.map((r) => r.p);
    }
  }
}

/**
 * Filter a list of project names down to those visible under the
 * resolved policy. Used by the available-projects endpoint.
 */
export async function filterVisibleProjectNames(
  policy: ScopePolicy,
  projectNames: string[],
): Promise<Set<string>> {
  if (policy.kind === "all") return new Set(projectNames);
  if (policy.kind === "none") return new Set();
  if (policy.kind === "guest") {
    const own = policy.projectName;
    return own !== null && projectNames.includes(own)
      ? new Set([own])
      : new Set();
  }
  if (projectNames.length === 0) return new Set();
  const rows = await db
    .select()
    .from(projectOrganizationsTable)
    .where(inArray(projectOrganizationsTable.projectName, projectNames));
  const owned = new Map(rows.map((r) => [r.projectName, r.organizationId]));
  const visible = new Set<string>();
  for (const name of projectNames) {
    if (owned.get(name) === policy.orgId) visible.add(name);
  }
  return visible;
}

/**
 * Convenience: compute the active org id for the current user (or
 * null for local users / no-org IDP users).
 */
export function getActiveOrgId(req: Request): string | null {
  return req.session.activeOrgId ?? null;
}

export function isLocalUser(user: User): boolean {
  return user.authSource !== "oidc";
}

/**
 * Centralized middleware: every project-keyed endpoint (load, disable,
 * delete, zip, tree, tests, anything that takes a project name) should
 * use this guard so org isolation is enforced once instead of being
 * duplicated per-route.
 *
 * Cross-org access returns 404 — never 403 — so an IDP user cannot
 * probe project names belonging to other orgs.
 *
 * `getProjectName` may return `null`/`undefined` when the route operates
 * on the *currently loaded* project; in that case we resolve it via
 * `getCurrentProject(userId)`. If neither is available the guard does
 * not enforce — the downstream handler will respond appropriately.
 *
 * Local users (no IDP membership) are unaffected: policy resolves to
 * `"all"` and the guard becomes a no-op, preserving pre-org behavior.
 */
export function requireProjectOrgAccess(
  getProjectName: (req: Request) => string | null | undefined,
) {
  return async function requireProjectOrgAccessMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const policy = await resolveScopePolicy(req);
    if (policy.kind === "all") {
      next();
      return;
    }
    const name = getProjectName(req);
    if (!name) {
      // Nothing to scope — let the handler decide.
      next();
      return;
    }
    if (policy.kind === "none") {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const ok = await canSeeProject(policy, name);
    if (!ok) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    next();
  };
}

/**
 * Imperative variant of {@link requireProjectOrgAccess} for handlers
 * that resolve the project name partway through their work (e.g. zip
 * download which canonicalizes the path before authorizing). Returns
 * `true` if the caller may act on `projectName`; `false` after sending
 * a 404 response (the caller should `return` immediately).
 */
export async function enforceProjectOrgAccess(
  req: Request,
  res: Response,
  projectName: string,
): Promise<boolean> {
  const policy = await resolveScopePolicy(req);
  if (policy.kind === "all") return true;
  if (policy.kind === "none") {
    res.status(404).json({ error: "Project not found" });
    return false;
  }
  const ok = await canSeeProject(policy, projectName);
  if (!ok) {
    res.status(404).json({ error: "Project not found" });
    return false;
  }
  return true;
}

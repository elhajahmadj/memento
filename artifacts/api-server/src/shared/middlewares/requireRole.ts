import { type Request, type Response, type NextFunction } from "express";
import type { UserRole } from "@workspace/db";
import { isAdminOrAssigned } from "@/features/assignments/infrastructure/assignmentService";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import {
  canSeeProject,
  resolveScopePolicy,
} from "@/features/auth/infrastructure/orgScope";
import { getEffectiveRole } from "@/shared/middlewares/effectiveRole";
import type { EffectiveRole } from "@/features/auth/domain/effectiveRole";

/**
 * Standard 403 message returned when an SSO caller has no resolvable
 * effective role on the current request — typically because they have
 * not yet selected an active organization, or because the IDP revoked
 * the previously-active org since their last sign-in. The frontend
 * can use this to prompt the user to pick an org.
 */
const NO_ACTIVE_ORG_FORBIDDEN =
  "Select an active organization to continue. Your effective role is " +
  "tied to the organization you are currently acting in.";

/**
 * Org-aware project access check shared by the role middlewares below.
 * For local users (policy "all") behaves exactly like the legacy
 * `isAdminOrAssigned`. For IDP users, the project must additionally
 * belong to the caller's active org — otherwise we treat it as if the
 * project does not exist (returning 404 at the route layer), keeping
 * cross-org existence unobservable.
 *
 * Authorization branches on the caller's *effective* role (per-org for
 * SSO users, global for local users) — not on `users.role` — so an SSO
 * Admin in OrgA who is Limited Admin in OrgB is correctly demoted when
 * acting under OrgB.
 *
 * Returns one of:
 * - "ok"            — caller may proceed
 * - "cross_org"     — IDP caller, project lives in a different org → 404
 * - "not_assigned"  — same-org caller without an assignment → 403
 */
async function resolveAccess(
  req: Request,
  userId: string,
  effective: EffectiveRole,
  projectName: string,
): Promise<"ok" | "cross_org" | "not_assigned"> {
  const policy = await resolveScopePolicy(req);
  if (policy.kind === "none") return "cross_org";
  // Every bounded policy (org tenancy and guest single-project) must
  // pass the visibility check. Only `"all"` — local users — skips it.
  if (policy.kind !== "all") {
    const visible = await canSeeProject(policy, projectName);
    if (!visible) return "cross_org";
  }
  // Memento Admin and full Admin sail through any in-org project.
  // Limited admins still need an explicit assignment within the org.
  if (effective === "memento_admin" || effective === "admin") return "ok";
  if (effective !== "limited_admin") return "not_assigned";
  if (await isAdminOrAssigned({ id: userId, role: effective }, projectName)) {
    return "ok";
  }
  return "not_assigned";
}

export function requireRole(...roles: UserRole[]) {
  return async function requireRoleMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const effective = await getEffectiveRole(req);
    if (!effective) {
      res.status(403).json({ error: NO_ACTIVE_ORG_FORBIDDEN });
      return;
    }
    // Memento Admin is a god-mode superset of every other role and
    // satisfies any role gate that admits another role.
    if (effective === "memento_admin") {
      next();
      return;
    }
    if (!roles.includes(effective)) {
      res.status(403).json({
        error: `Forbidden: '${roles.join("' or '")}' role required`,
      });
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole("admin");
export const requireAnyAdmin = requireRole("admin", "limited_admin");
export const requireMementoAdmin = requireRole("memento_admin");

/**
 * Allow the request when the caller is a full admin, or a limited_admin
 * with an active assignment to `getProjectName(req)`. Use this for
 * project-scoped admin actions like editing files, approving forks, or
 * approving submissions.
 */
export function requireAdminOrAssigned(
  getProjectName: (req: Request) => string | null | undefined,
) {
  return async function (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const effective = await getEffectiveRole(req);
    if (!effective) {
      res.status(403).json({ error: NO_ACTIVE_ORG_FORBIDDEN });
      return;
    }
    if (
      effective !== "admin" &&
      effective !== "limited_admin" &&
      effective !== "memento_admin"
    ) {
      res
        .status(403)
        .json({ error: "Forbidden: admin or limited_admin required" });
      return;
    }
    const project = getProjectName(req);
    if (!project) {
      res.status(400).json({ error: "Project name required" });
      return;
    }
    const verdict = await resolveAccess(req, user.id, effective, project);
    if (verdict === "ok") {
      next();
      return;
    }
    if (verdict === "cross_org") {
      // 404 (not 403) so cross-org existence isn't observable.
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res
      .status(403)
      .json({ error: "Forbidden: not assigned to this project" });
  };
}

/**
 * Read-side guard for endpoints that operate on the *currently loaded*
 * project. Allows full admins, limited admins assigned to that project,
 * and any other authenticated role (the loaded project is the user's own
 * — for limited users this is enforced at /projects/load by fork
 * ownership).
 *
 * Specifically blocks limited_admin users whose assignment for the
 * loaded project was revoked while they had it loaded.
 */
export async function requireAdminOrAssignedToCurrentProjectOrOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const effective = await getEffectiveRole(req);
  if (!effective) {
    res.status(403).json({ error: NO_ACTIVE_ORG_FORBIDDEN });
    return;
  }
  // Limited users normally pass through (their loaded project is a
  // fork they own, gated at /projects/load). However, OIDC limited
  // users who switched their active org since loading the project
  // must NOT keep acting on a now-cross-org project. We still require
  // a current project to exist so we can check it; absent a project
  // we preserve the legacy pass-through behavior.
  if (
    effective !== "limited_admin" &&
    effective !== "admin" &&
    effective !== "memento_admin"
  ) {
    const project = getCurrentProject(user.id);
    if (project) {
      const policy = await resolveScopePolicy(req);
      if (policy.kind === "none") {
        res.status(404).json({ error: "No project loaded" });
        return;
      }
      // Bounded policies (org tenancy, guest single-project) must all
      // re-check visibility; only local users ("all") skip it.
      if (policy.kind !== "all") {
        const visible = await canSeeProject(policy, project.solutionName);
        if (!visible) {
          res.status(404).json({ error: "No project loaded" });
          return;
        }
      }
    }
    next();
    return;
  }
  const project = getCurrentProject(user.id);
  if (!project) {
    res.status(404).json({ error: "No project loaded" });
    return;
  }
  const verdict = await resolveAccess(
    req,
    user.id,
    effective,
    project.solutionName,
  );
  if (verdict === "ok") {
    next();
    return;
  }
  if (verdict === "cross_org") {
    // The current project belongs to another org (e.g. user switched
    // active org while a stale project was loaded). Treat as if it
    // doesn't exist.
    res.status(404).json({ error: "No project loaded" });
    return;
  }
  res
    .status(403)
    .json({ error: "Forbidden: not assigned to this project" });
}

/**
 * Same as `requireAdminOrAssignedToCurrentProjectOrOwner`, but does NOT
 * require admins to have a project loaded. Use for endpoints that
 * operate on the global recording session (stop/discard/finalize) or
 * that surface their own "no project" 400 (clear-hook-backups), where
 * the strict 404 from the standard guard hides the route's own
 * validation. When a project IS loaded for an admin, the org/assignment
 * checks still run.
 */
export async function requireAdminOrAssignedToCurrentProjectOrOwnerAllowNoProject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const effective = await getEffectiveRole(req);
  if (!effective) {
    res.status(403).json({ error: NO_ACTIVE_ORG_FORBIDDEN });
    return;
  }
  if (
    effective !== "limited_admin" &&
    effective !== "admin" &&
    effective !== "memento_admin"
  ) {
    const project = getCurrentProject(user.id);
    if (project) {
      const policy = await resolveScopePolicy(req);
      if (policy.kind === "none") {
        res.status(404).json({ error: "No project loaded" });
        return;
      }
      // Bounded policies (org tenancy, guest single-project) must all
      // re-check visibility; only local users ("all") skip it.
      if (policy.kind !== "all") {
        const visible = await canSeeProject(policy, project.solutionName);
        if (!visible) {
          res.status(404).json({ error: "No project loaded" });
          return;
        }
      }
    }
    next();
    return;
  }
  const project = getCurrentProject(user.id);
  if (!project) {
    // Admin/limited_admin without a project loaded is allowed through
    // here so the route can run its own validation (e.g. return 400
    // when no recording session exists). The standard guard returns
    // 404 in this case, which masks the route's own error path.
    next();
    return;
  }
  const verdict = await resolveAccess(
    req,
    user.id,
    effective,
    project.solutionName,
  );
  if (verdict === "ok") {
    next();
    return;
  }
  if (verdict === "cross_org") {
    res.status(404).json({ error: "No project loaded" });
    return;
  }
  res
    .status(403)
    .json({ error: "Forbidden: not assigned to this project" });
}

/**
 * Project-scoped guard for endpoints that operate on the *currently loaded*
 * project (resolved via `getCurrentProject(userId)`). Allows full admins
 * and limited admins assigned to that project.
 */
export async function requireAdminOrAssignedToCurrentProject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const effective = await getEffectiveRole(req);
  if (!effective) {
    res.status(403).json({ error: NO_ACTIVE_ORG_FORBIDDEN });
    return;
  }
  if (
    effective !== "admin" &&
    effective !== "limited_admin" &&
    effective !== "memento_admin"
  ) {
    res
      .status(403)
      .json({ error: "Forbidden: admin or limited_admin required" });
    return;
  }
  const project = getCurrentProject(user.id);
  if (!project) {
    res.status(404).json({ error: "No project loaded" });
    return;
  }
  const verdict = await resolveAccess(
    req,
    user.id,
    effective,
    project.solutionName,
  );
  if (verdict === "ok") {
    next();
    return;
  }
  if (verdict === "cross_org") {
    res.status(404).json({ error: "No project loaded" });
    return;
  }
  res
    .status(403)
    .json({ error: "Forbidden: not assigned to this project" });
}

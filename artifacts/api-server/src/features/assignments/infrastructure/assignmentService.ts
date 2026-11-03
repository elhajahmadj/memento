import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  projectAssignmentsTable,
  projectOrganizationsTable,
  usersTable,
  type ProjectAssignment,
  type User,
} from "@workspace/db";

export interface AssignmentRow extends ProjectAssignment {
  username: string;
}

/**
 * List all assignments. When `orgScope` is provided (IDP caller with an
 * active org), the result is restricted to assignments whose project is
 * stamped with that org. Local callers (`orgScope` omitted) see every
 * assignment, preserving pre-org behavior.
 */
export async function listAssignments(args?: {
  orgScope?: { orgId: string };
}): Promise<AssignmentRow[]> {
  const rows = await db
    .select({
      a: projectAssignmentsTable,
      username: usersTable.username,
    })
    .from(projectAssignmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, projectAssignmentsTable.userId));
  if (!args?.orgScope) {
    return rows.map((r) => ({ ...r.a, username: r.username }));
  }
  // Filter by project_organizations membership. We accept assignments
  // whose stored organizationId matches OR whose project's org-stamp
  // matches (the row stamp may be stale if the assignment predated the
  // org rollout).
  const projectNames = rows.map((r) => r.a.projectName);
  if (projectNames.length === 0) return [];
  const stamps = await db
    .select()
    .from(projectOrganizationsTable)
    .where(inArray(projectOrganizationsTable.projectName, projectNames));
  const stampByName = new Map(stamps.map((s) => [s.projectName, s.organizationId]));
  return rows
    .filter((r) => {
      const projOrg = stampByName.get(r.a.projectName) ?? null;
      const rowOrg = r.a.organizationId ?? null;
      return projOrg === args.orgScope!.orgId || rowOrg === args.orgScope!.orgId;
    })
    .map((r) => ({ ...r.a, username: r.username }));
}

export async function listAssignmentsForUser(
  userId: string,
): Promise<ProjectAssignment[]> {
  return db
    .select()
    .from(projectAssignmentsTable)
    .where(eq(projectAssignmentsTable.userId, userId));
}

export async function getAssignedProjectNames(
  userId: string,
): Promise<string[]> {
  const rows = await listAssignmentsForUser(userId);
  return rows.map((r) => r.projectName);
}

export async function isAssigned(
  userId: string,
  projectName: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: projectAssignmentsTable.id })
    .from(projectAssignmentsTable)
    .where(
      and(
        eq(projectAssignmentsTable.userId, userId),
        eq(projectAssignmentsTable.projectName, projectName),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Project-scoped admin check. The `role` field on `user` MUST be the
 * caller's *effective* memento role for the current request — global
 * (`users.role`) for local users, per-org (`user_organizations.role`
 * for the active org) for SSO users. Callers should resolve via
 * {@link import("@/shared/middlewares/effectiveRole").getEffectiveRole}
 * before invoking this helper, otherwise SSO admins whose global
 * column has been demoted to `limited` (per-org-roles foundation)
 * will be silently rejected.
 */
export async function isAdminOrAssigned(
  user: Pick<User, "id" | "role">,
  projectName: string,
): Promise<boolean> {
  if (user.role === "admin" || user.role === "memento_admin") return true;
  // NOTE: intentionally limited to `limited_admin` here. Although
  // `limited` (User-role) accounts can now have assignment rows
  // (granted on approval of a create-project request), this helper
  // also gates project-admin actions like `/projects/disable`,
  // approval review, fork management, etc. Granting those to a User
  // would be a privilege escalation. The /projects/load path uses
  // `isAssigned(user.id, project)` directly for limited users.
  if (user.role !== "limited_admin") return false;
  return isAssigned(user.id, projectName);
}

export async function createAssignment(args: {
  userId: string;
  projectName: string;
  assignedBy: string;
  /** Caller's active org, when present (IDP creators). */
  organizationId?: string | null | undefined;
}): Promise<AssignmentRow> {
  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, args.userId))
    .limit(1);
  if (!u) throw new Error("User not found");
  if (u.role !== "limited_admin" && u.role !== "limited") {
    throw new Error(
      "Assignments can only be created for limited_admin or limited users",
    );
  }
  const existing = await isAssigned(args.userId, args.projectName);
  if (existing) {
    throw new Error("User is already assigned to this project");
  }
  const [inserted] = await db
    .insert(projectAssignmentsTable)
    .values({
      userId: args.userId,
      projectName: args.projectName,
      assignedBy: args.assignedBy,
      organizationId: args.organizationId ?? null,
    })
    .returning();
  if (!inserted) throw new Error("Failed to create assignment");
  return { ...inserted, username: u.username };
}

export async function removeAssignment(args: {
  userId: string;
  projectName: string;
}): Promise<{ removed: boolean; username: string | null }> {
  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, args.userId))
    .limit(1);
  const result = await db
    .delete(projectAssignmentsTable)
    .where(
      and(
        eq(projectAssignmentsTable.userId, args.userId),
        eq(projectAssignmentsTable.projectName, args.projectName),
      ),
    )
    .returning({ id: projectAssignmentsTable.id });
  return { removed: result.length > 0, username: u?.username ?? null };
}

/**
 * When a limited_admin loses their assignment for a project, sweep any
 * scoped queues they were responsible for. Today the per-project review
 * pool is shared across every admin (full or scoped), so there is nothing
 * to physically reassign — the remaining admins still see those items.
 * We just count how many open items the user is no longer able to action
 * so callers can include the figure in their audit/notification payload.
 */
export async function listItemsLosingReviewer(args: {
  projectName: string;
}): Promise<{ pendingForkIds: string[]; pendingApprovalIds: string[] }> {
  const { forksTable, approvalSubmissionsTable } = await import(
    "@workspace/db"
  );
  const pendingForks = await db
    .select({ id: forksTable.id })
    .from(forksTable)
    .where(
      and(
        eq(forksTable.projectName, args.projectName),
        eq(forksTable.status, "pending"),
      ),
    );
  const pendingApprovals = await db
    .select({ id: approvalSubmissionsTable.id })
    .from(approvalSubmissionsTable)
    .innerJoin(forksTable, eq(forksTable.id, approvalSubmissionsTable.forkId))
    .where(
      and(
        eq(forksTable.projectName, args.projectName),
        eq(approvalSubmissionsTable.status, "pending"),
      ),
    );
  return {
    pendingForkIds: pendingForks.map((r) => r.id),
    pendingApprovalIds: pendingApprovals.map((r) => r.id),
  };
}

export async function countItemsLosingReviewer(args: {
  projectName: string;
}): Promise<{ pendingForks: number; pendingApprovals: number }> {
  const lists = await listItemsLosingReviewer(args);
  return {
    pendingForks: lists.pendingForkIds.length,
    pendingApprovals: lists.pendingApprovalIds.length,
  };
}

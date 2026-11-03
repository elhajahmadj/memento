import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  projectAccessRequestsTable,
  projectAssignmentsTable,
  projectOrganizationsTable,
  usersTable,
  type AccessRequestStatus,
  type ProjectAccessRequest,
} from "@workspace/db";

export interface AccessRequestRow extends ProjectAccessRequest {
  username: string;
}

function shape(rows: Array<{ r: ProjectAccessRequest; username: string }>) {
  return rows.map((x) => ({ ...x.r, username: x.username }));
}

export async function listAccessRequests(filter?: {
  status?: AccessRequestStatus | undefined;
  orgScope?: { orgId: string } | undefined;
}): Promise<AccessRequestRow[]> {
  const base = db
    .select({
      r: projectAccessRequestsTable,
      username: usersTable.username,
    })
    .from(projectAccessRequestsTable)
    .innerJoin(
      usersTable,
      eq(usersTable.id, projectAccessRequestsTable.userId),
    );
  const rows = filter?.status
    ? await base
        .where(eq(projectAccessRequestsTable.status, filter.status))
        .orderBy(desc(projectAccessRequestsTable.requestedAt))
    : await base.orderBy(desc(projectAccessRequestsTable.requestedAt));
  if (!filter?.orgScope) return shape(rows);
  // Org-scoped admins only see requests targeting projects in their org
  // (or requests whose stored organizationId matches — see comment in
  // listAssignments).
  const projectNames = rows.map((x) => x.r.projectName);
  if (projectNames.length === 0) return [];
  const stamps = await db
    .select()
    .from(projectOrganizationsTable)
    .where(inArray(projectOrganizationsTable.projectName, projectNames));
  const stampByName = new Map(
    stamps.map((s) => [s.projectName, s.organizationId]),
  );
  return shape(
    rows.filter((x) => {
      const projOrg = stampByName.get(x.r.projectName) ?? null;
      const rowOrg = x.r.organizationId ?? null;
      return (
        projOrg === filter.orgScope!.orgId || rowOrg === filter.orgScope!.orgId
      );
    }),
  );
}

export async function listAccessRequestsForUser(
  userId: string,
  options?: { orgScope?: { orgId: string } },
): Promise<ProjectAccessRequest[]> {
  const rows = await db
    .select()
    .from(projectAccessRequestsTable)
    .where(eq(projectAccessRequestsTable.userId, userId))
    .orderBy(desc(projectAccessRequestsTable.requestedAt));
  if (!options?.orgScope) return rows;
  // Org-scoped callers (OIDC users) only see their own requests for
  // projects stamped with their active org — or requests they filed
  // while that org was active (rowOrg). Mirrors listAccessRequests.
  const projectNames = rows.map((r) => r.projectName);
  if (projectNames.length === 0) return [];
  const stamps = await db
    .select()
    .from(projectOrganizationsTable)
    .where(inArray(projectOrganizationsTable.projectName, projectNames));
  const stampByName = new Map(
    stamps.map((s) => [s.projectName, s.organizationId]),
  );
  return rows.filter((r) => {
    const projOrg = stampByName.get(r.projectName) ?? null;
    const rowOrg = r.organizationId ?? null;
    return (
      projOrg === options.orgScope!.orgId || rowOrg === options.orgScope!.orgId
    );
  });
}

export async function getAccessRequestById(
  id: string,
): Promise<AccessRequestRow | null> {
  const rows = await db
    .select({
      r: projectAccessRequestsTable,
      username: usersTable.username,
    })
    .from(projectAccessRequestsTable)
    .innerJoin(
      usersTable,
      eq(usersTable.id, projectAccessRequestsTable.userId),
    )
    .where(eq(projectAccessRequestsTable.id, id))
    .limit(1);
  const r = rows[0];
  return r ? { ...r.r, username: r.username } : null;
}

export async function findPendingRequest(
  userId: string,
  projectName: string,
): Promise<ProjectAccessRequest | null> {
  const rows = await db
    .select()
    .from(projectAccessRequestsTable)
    .where(
      and(
        eq(projectAccessRequestsTable.userId, userId),
        eq(projectAccessRequestsTable.projectName, projectName),
        eq(projectAccessRequestsTable.status, "pending"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createAccessRequest(args: {
  userId: string;
  projectName: string;
  organizationId?: string | null;
}): Promise<ProjectAccessRequest> {
  // No double-pending requests for the same project from the same user.
  const dup = await findPendingRequest(args.userId, args.projectName);
  if (dup) {
    throw new Error("You already have a pending request for this project");
  }
  // Don't bother creating one if the user already has the assignment.
  const existingAssign = await db
    .select({ id: projectAssignmentsTable.id })
    .from(projectAssignmentsTable)
    .where(
      and(
        eq(projectAssignmentsTable.userId, args.userId),
        eq(projectAssignmentsTable.projectName, args.projectName),
      ),
    )
    .limit(1);
  if (existingAssign.length > 0) {
    throw new Error("You already have access to this project");
  }
  const [inserted] = await db
    .insert(projectAccessRequestsTable)
    .values({
      userId: args.userId,
      projectName: args.projectName,
      status: "pending",
      organizationId: args.organizationId ?? null,
    })
    .returning();
  if (!inserted) throw new Error("Failed to create request");
  return inserted;
}

export async function approveAccessRequest(args: {
  id: string;
  decidedBy: string;
  note?: string | null;
}): Promise<{ row: AccessRequestRow; assignmentCreated: boolean }> {
  const existing = await getAccessRequestById(args.id);
  if (!existing) throw new Error("Request not found");
  if (existing.status !== "pending") {
    throw new Error("Request has already been decided");
  }
  let assignmentCreated = false;
  // Insert assignment if it doesn't already exist (idempotent).
  const has = await db
    .select({ id: projectAssignmentsTable.id })
    .from(projectAssignmentsTable)
    .where(
      and(
        eq(projectAssignmentsTable.userId, existing.userId),
        eq(projectAssignmentsTable.projectName, existing.projectName),
      ),
    )
    .limit(1);
  if (has.length === 0) {
    // Stamp the new assignment with the project's owning org (if any),
    // falling back to the org the access request itself was filed
    // under. Without this, assignments created via approval would
    // bypass org tagging and become invisible to org-scoped admin
    // queries even though the underlying project is org-owned.
    const projOrg = await db
      .select()
      .from(projectOrganizationsTable)
      .where(eq(projectOrganizationsTable.projectName, existing.projectName))
      .limit(1);
    const organizationId =
      projOrg[0]?.organizationId ?? existing.organizationId ?? null;
    await db.insert(projectAssignmentsTable).values({
      userId: existing.userId,
      projectName: existing.projectName,
      assignedBy: args.decidedBy,
      organizationId,
    });
    assignmentCreated = true;
  }
  const [updated] = await db
    .update(projectAccessRequestsTable)
    .set({
      status: "approved",
      decidedAt: new Date(),
      decidedBy: args.decidedBy,
      note: args.note ?? null,
    })
    .where(eq(projectAccessRequestsTable.id, args.id))
    .returning();
  if (!updated) throw new Error("Failed to approve request");
  return {
    row: { ...updated, username: existing.username },
    assignmentCreated,
  };
}

export async function denyAccessRequest(args: {
  id: string;
  decidedBy: string;
  note?: string | null;
}): Promise<AccessRequestRow> {
  const existing = await getAccessRequestById(args.id);
  if (!existing) throw new Error("Request not found");
  if (existing.status !== "pending") {
    throw new Error("Request has already been decided");
  }
  const [updated] = await db
    .update(projectAccessRequestsTable)
    .set({
      status: "denied",
      decidedAt: new Date(),
      decidedBy: args.decidedBy,
      note: args.note ?? null,
    })
    .where(eq(projectAccessRequestsTable.id, args.id))
    .returning();
  if (!updated) throw new Error("Failed to deny request");
  return { ...updated, username: existing.username };
}

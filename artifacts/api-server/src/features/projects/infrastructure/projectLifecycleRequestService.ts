import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  projectLifecycleRequestsTable,
  projectOrganizationsTable,
  usersTable,
  type ProjectLifecycleRequest,
  type ProjectLifecycleRequestStatus,
  type UserRole,
} from "@workspace/db";

export interface LifecycleRequestRow extends ProjectLifecycleRequest {
  requestedByUsername: string;
}

function shape(
  rows: Array<{ r: ProjectLifecycleRequest; username: string }>,
): LifecycleRequestRow[] {
  return rows.map((x) => ({ ...x.r, requestedByUsername: x.username }));
}

export async function listLifecycleRequests(filter?: {
  status?: ProjectLifecycleRequestStatus | undefined;
  kind?: ProjectLifecycleRequest["kind"] | undefined;
  orgScope?: { orgId: string } | undefined;
}): Promise<LifecycleRequestRow[]> {
  const conds = [];
  if (filter?.status)
    conds.push(eq(projectLifecycleRequestsTable.status, filter.status));
  if (filter?.kind)
    conds.push(eq(projectLifecycleRequestsTable.kind, filter.kind));
  const where = conds.length === 1 ? conds[0] : conds.length > 1 ? and(...conds) : undefined;
  const base = db
    .select({
      r: projectLifecycleRequestsTable,
      username: usersTable.username,
    })
    .from(projectLifecycleRequestsTable)
    .innerJoin(
      usersTable,
      eq(usersTable.id, projectLifecycleRequestsTable.requestedByUserId),
    );
  const rows = where
    ? await base.where(where).orderBy(desc(projectLifecycleRequestsTable.requestedAt))
    : await base.orderBy(desc(projectLifecycleRequestsTable.requestedAt));
  if (!filter?.orgScope) return shape(rows);
  const orgId = filter.orgScope.orgId;
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
      return projOrg === orgId || rowOrg === orgId;
    }),
  );
}

export async function listLifecycleRequestsForUser(
  userId: string,
): Promise<LifecycleRequestRow[]> {
  const rows = await db
    .select({
      r: projectLifecycleRequestsTable,
      username: usersTable.username,
    })
    .from(projectLifecycleRequestsTable)
    .innerJoin(
      usersTable,
      eq(usersTable.id, projectLifecycleRequestsTable.requestedByUserId),
    )
    .where(eq(projectLifecycleRequestsTable.requestedByUserId, userId))
    .orderBy(desc(projectLifecycleRequestsTable.requestedAt));
  return shape(rows);
}

export async function getLifecycleRequestById(
  id: string,
): Promise<LifecycleRequestRow | null> {
  const rows = await db
    .select({
      r: projectLifecycleRequestsTable,
      username: usersTable.username,
    })
    .from(projectLifecycleRequestsTable)
    .innerJoin(
      usersTable,
      eq(usersTable.id, projectLifecycleRequestsTable.requestedByUserId),
    )
    .where(eq(projectLifecycleRequestsTable.id, id))
    .limit(1);
  const r = rows[0];
  return r ? { ...r.r, requestedByUsername: r.username } : null;
}

export async function listPendingCreateProjectNames(filter?: {
  orgScope?: { orgId: string };
}): Promise<Set<string>> {
  const rows = await listLifecycleRequests({
    status: "pending",
    kind: "create",
    ...(filter?.orgScope ? { orgScope: filter.orgScope } : {}),
  });
  return new Set(rows.map((r) => r.projectName));
}

export async function createPendingCreateRequest(args: {
  projectName: string;
  requestedByUserId: string;
  requestedByRole: UserRole;
  organizationId?: string | null;
  language?: string | null;
  solutionType?: string | null;
}): Promise<LifecycleRequestRow> {
  const [inserted] = await db
    .insert(projectLifecycleRequestsTable)
    .values({
      projectName: args.projectName,
      kind: "create",
      requestedByUserId: args.requestedByUserId,
      requestedByRole: args.requestedByRole,
      organizationId: args.organizationId ?? null,
      language: args.language ?? null,
      solutionType: args.solutionType ?? null,
    })
    .returning();
  if (!inserted) throw new Error("Failed to create lifecycle request");
  const [u] = await db
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, args.requestedByUserId))
    .limit(1);
  return { ...inserted, requestedByUsername: u?.username ?? "" };
}

export async function approveLifecycleRequest(args: {
  id: string;
  decidedBy: string;
  note?: string | null;
}): Promise<LifecycleRequestRow> {
  const existing = await getLifecycleRequestById(args.id);
  if (!existing) throw new Error("Request not found");
  if (existing.status !== "pending") {
    throw new Error("Request has already been decided");
  }
  const [updated] = await db
    .update(projectLifecycleRequestsTable)
    .set({
      status: "approved",
      decidedByUserId: args.decidedBy,
      decidedAt: new Date(),
      decisionNote: args.note ?? null,
    })
    .where(eq(projectLifecycleRequestsTable.id, args.id))
    .returning();
  if (!updated) throw new Error("Failed to approve request");
  return { ...updated, requestedByUsername: existing.requestedByUsername };
}

export async function rejectLifecycleRequest(args: {
  id: string;
  decidedBy: string;
  note?: string | null;
}): Promise<LifecycleRequestRow> {
  const existing = await getLifecycleRequestById(args.id);
  if (!existing) throw new Error("Request not found");
  if (existing.status !== "pending") {
    throw new Error("Request has already been decided");
  }
  const [updated] = await db
    .update(projectLifecycleRequestsTable)
    .set({
      status: "rejected",
      decidedByUserId: args.decidedBy,
      decidedAt: new Date(),
      decisionNote: args.note ?? null,
    })
    .where(eq(projectLifecycleRequestsTable.id, args.id))
    .returning();
  if (!updated) throw new Error("Failed to reject request");
  return { ...updated, requestedByUsername: existing.requestedByUsername };
}

export async function deleteLifecycleRequest(id: string): Promise<void> {
  await db
    .delete(projectLifecycleRequestsTable)
    .where(eq(projectLifecycleRequestsTable.id, id));
}

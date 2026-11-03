import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  projectLifecycleRequestsTable,
  usersTable,
  type ProjectLifecycleRequest,
  type ProjectLifecycleRequestKind,
  type ProjectLifecycleRequestStatus,
  type User,
} from "@workspace/db";

export interface LifecycleRequestView {
  id: string;
  projectName: string;
  kind: ProjectLifecycleRequestKind;
  status: ProjectLifecycleRequestStatus;
  requestedByUserId: string;
  requestedByUsername: string;
  requestedByRole: User["role"];
  requestedAt: string;
  decidedByUserId: string | null;
  decidedByUsername: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function viewFromRow(
  row: ProjectLifecycleRequest,
  requester: Pick<User, "username" | "role">,
  decider: Pick<User, "username"> | null,
): LifecycleRequestView {
  return {
    id: row.id,
    projectName: row.projectName,
    kind: row.kind,
    status: row.status,
    requestedByUserId: row.requestedByUserId,
    requestedByUsername: requester.username,
    requestedByRole: requester.role,
    requestedAt: row.requestedAt.toISOString(),
    decidedByUserId: row.decidedByUserId,
    decidedByUsername: decider?.username ?? null,
    decidedAt: toIso(row.decidedAt),
    decisionNote: row.decisionNote,
  };
}

async function hydrate(
  rows: ProjectLifecycleRequest[],
): Promise<LifecycleRequestView[]> {
  if (rows.length === 0) return [];
  const userIds = new Set<string>();
  for (const r of rows) {
    userIds.add(r.requestedByUserId);
    if (r.decidedByUserId) userIds.add(r.decidedByUserId);
  }
  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, Array.from(userIds)));
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((row) => {
    const requester = byId.get(row.requestedByUserId);
    const decider = row.decidedByUserId
      ? byId.get(row.decidedByUserId) ?? null
      : null;
    return viewFromRow(
      row,
      {
        username: requester?.username ?? "(deleted user)",
        role: requester?.role ?? "limited",
      },
      decider ? { username: decider.username } : null,
    );
  });
}

export async function createDeleteRequest(args: {
  projectName: string;
  organizationId: string | null;
  requestedByUserId: string;
  requestedByRole: User["role"];
}): Promise<LifecycleRequestView> {
  const [row] = await db
    .insert(projectLifecycleRequestsTable)
    .values({
      projectName: args.projectName,
      organizationId: args.organizationId,
      kind: "delete",
      requestedByUserId: args.requestedByUserId,
      requestedByRole: args.requestedByRole,
    })
    .returning();
  if (!row) throw new Error("Failed to create lifecycle request");
  const [view] = await hydrate([row]);
  return view!;
}

export async function createClearFilesRequest(args: {
  projectName: string;
  organizationId: string | null;
  requestedByUserId: string;
  requestedByRole: User["role"];
}): Promise<LifecycleRequestView> {
  const [row] = await db
    .insert(projectLifecycleRequestsTable)
    .values({
      projectName: args.projectName,
      organizationId: args.organizationId,
      kind: "clear_files",
      requestedByUserId: args.requestedByUserId,
      requestedByRole: args.requestedByRole,
    })
    .returning();
  if (!row) throw new Error("Failed to create lifecycle request");
  const [view] = await hydrate([row]);
  return view!;
}

export async function getPendingClearFilesRequestForProject(
  projectName: string,
): Promise<LifecycleRequestView | null> {
  const rows = await db
    .select()
    .from(projectLifecycleRequestsTable)
    .where(
      and(
        eq(projectLifecycleRequestsTable.projectName, projectName),
        eq(projectLifecycleRequestsTable.kind, "clear_files"),
        eq(projectLifecycleRequestsTable.status, "pending"),
      ),
    )
    .orderBy(desc(projectLifecycleRequestsTable.requestedAt))
    .limit(1);
  if (rows.length === 0) return null;
  const [view] = await hydrate(rows);
  return view ?? null;
}

export async function getPendingClearFilesRequestsForProjects(
  projectNames: string[],
): Promise<Map<string, LifecycleRequestView>> {
  const out = new Map<string, LifecycleRequestView>();
  if (projectNames.length === 0) return out;
  const rows = await db
    .select()
    .from(projectLifecycleRequestsTable)
    .where(
      and(
        inArray(projectLifecycleRequestsTable.projectName, projectNames),
        eq(projectLifecycleRequestsTable.kind, "clear_files"),
        eq(projectLifecycleRequestsTable.status, "pending"),
      ),
    );
  const views = await hydrate(rows);
  for (const v of views) {
    if (!out.has(v.projectName)) out.set(v.projectName, v);
  }
  return out;
}

export async function getRequestById(
  id: string,
): Promise<LifecycleRequestView | null> {
  const rows = await db
    .select()
    .from(projectLifecycleRequestsTable)
    .where(eq(projectLifecycleRequestsTable.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const [view] = await hydrate(rows);
  return view ?? null;
}

export async function getPendingDeleteRequestForProject(
  projectName: string,
): Promise<LifecycleRequestView | null> {
  const rows = await db
    .select()
    .from(projectLifecycleRequestsTable)
    .where(
      and(
        eq(projectLifecycleRequestsTable.projectName, projectName),
        eq(projectLifecycleRequestsTable.kind, "delete"),
        eq(projectLifecycleRequestsTable.status, "pending"),
      ),
    )
    .orderBy(desc(projectLifecycleRequestsTable.requestedAt))
    .limit(1);
  if (rows.length === 0) return null;
  const [view] = await hydrate(rows);
  return view ?? null;
}

export async function getPendingDeleteRequestsForProjects(
  projectNames: string[],
): Promise<Map<string, LifecycleRequestView>> {
  const out = new Map<string, LifecycleRequestView>();
  if (projectNames.length === 0) return out;
  const rows = await db
    .select()
    .from(projectLifecycleRequestsTable)
    .where(
      and(
        inArray(projectLifecycleRequestsTable.projectName, projectNames),
        eq(projectLifecycleRequestsTable.kind, "delete"),
        eq(projectLifecycleRequestsTable.status, "pending"),
      ),
    );
  const views = await hydrate(rows);
  for (const v of views) {
    // Keep the most recent if duplicates (shouldn't happen, but defensive).
    if (!out.has(v.projectName)) out.set(v.projectName, v);
  }
  return out;
}

export async function listLifecycleRequests(args: {
  status?: ProjectLifecycleRequestStatus;
  organizationId: string | null;
  /** When true, restrict to requests filed by this user. */
  forRequesterId?: string;
  /** When set, restrict to a specific org (`null` = unowned-only). */
  scopeKind: "all" | "org" | "none";
}): Promise<LifecycleRequestView[]> {
  if (args.scopeKind === "none") return [];
  const where = [] as Array<ReturnType<typeof eq>>;
  if (args.status) {
    where.push(eq(projectLifecycleRequestsTable.status, args.status));
  }
  if (args.scopeKind === "org" && args.organizationId) {
    where.push(
      eq(projectLifecycleRequestsTable.organizationId, args.organizationId),
    );
  }
  if (args.forRequesterId) {
    where.push(
      eq(projectLifecycleRequestsTable.requestedByUserId, args.forRequesterId),
    );
  }
  const rows = await db
    .select()
    .from(projectLifecycleRequestsTable)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(projectLifecycleRequestsTable.requestedAt));
  return hydrate(rows);
}

export async function markDecided(args: {
  id: string;
  status: "approved" | "rejected";
  decidedByUserId: string;
  decisionNote?: string | null;
}): Promise<LifecycleRequestView | null> {
  const [updated] = await db
    .update(projectLifecycleRequestsTable)
    .set({
      status: args.status,
      decidedByUserId: args.decidedByUserId,
      decidedAt: new Date(),
      decisionNote: args.decisionNote ?? null,
    })
    .where(
      and(
        eq(projectLifecycleRequestsTable.id, args.id),
        eq(projectLifecycleRequestsTable.status, "pending"),
      ),
    )
    .returning();
  if (!updated) return null;
  const [view] = await hydrate([updated]);
  return view ?? null;
}

export async function deleteRequestRow(id: string): Promise<void> {
  await db
    .delete(projectLifecycleRequestsTable)
    .where(eq(projectLifecycleRequestsTable.id, id));
}

import { desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  ssoAccessRequestsTable,
  usersTable,
  type SsoAccessRequest,
} from "@workspace/db";
import { logger } from "@/shared/logger";

export type SsoAccessRequestGate =
  | "no_memento_user"
  | "no_memento_access"
  | "no_org";

const VALID_GATES: readonly SsoAccessRequestGate[] = [
  "no_memento_user",
  "no_memento_access",
  "no_org",
];

export function isValidGate(value: string): value is SsoAccessRequestGate {
  return (VALID_GATES as readonly string[]).includes(value);
}

export interface PublicSsoAccessRequest {
  id: string;
  email: string;
  gate: SsoAccessRequestGate;
  orgKey: string | null;
  message: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolvedByEmail: string | null;
}

const LIST_LIMIT = 100;

function rowToPublic(
  row: SsoAccessRequest,
  resolverEmail: string | null,
): PublicSsoAccessRequest {
  const gate: SsoAccessRequestGate = isValidGate(row.gate) ? row.gate : "no_org";
  return {
    id: row.id,
    email: row.email,
    gate,
    orgKey: row.orgKey,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedByUserId: row.resolvedByUserId,
    resolvedByEmail: resolverEmail,
  };
}

/**
 * Record an in-app "Request access" submission from the SSO deny
 * banner. Unauthenticated callers — no session, no user row. Returns
 * the persisted row's id on success, or null on a database error so
 * the route can still respond 204 (we don't want to leak retryable
 * infra noise back to anonymous callers).
 */
export async function recordSsoAccessRequest(input: {
  email: string;
  gate: SsoAccessRequestGate;
  orgKey: string | null;
  message: string | null;
}): Promise<string | null> {
  try {
    const [row] = await db
      .insert(ssoAccessRequestsTable)
      .values({
        email: input.email,
        gate: input.gate,
        orgKey: input.orgKey,
        message: input.message,
      })
      .returning({ id: ssoAccessRequestsTable.id });
    return row?.id ?? null;
  } catch (err) {
    logger.warn({ err, gate: input.gate }, "Failed to record SSO access request");
    return null;
  }
}

/**
 * Return the most recent access requests (newest first), capped at
 * `LIST_LIMIT`. When `includeResolved` is false (the default) only
 * pending rows are returned, so the admin queue isn't a wall of
 * already-handled rows.
 */
export async function listRecentSsoAccessRequests(
  options: { includeResolved?: boolean } = {},
): Promise<PublicSsoAccessRequest[]> {
  const includeResolved = options.includeResolved === true;
  const rows = await db
    .select({
      row: ssoAccessRequestsTable,
      resolverEmail: usersTable.email,
    })
    .from(ssoAccessRequestsTable)
    .leftJoin(
      usersTable,
      eq(usersTable.id, ssoAccessRequestsTable.resolvedByUserId),
    )
    .where(
      includeResolved ? undefined : isNull(ssoAccessRequestsTable.resolvedAt),
    )
    .orderBy(desc(ssoAccessRequestsTable.createdAt))
    .limit(LIST_LIMIT);
  return rows.map((r) => rowToPublic(r.row, r.resolverEmail ?? null));
}

export async function getSsoAccessRequestById(
  id: string,
): Promise<PublicSsoAccessRequest | null> {
  const rows = await db
    .select({
      row: ssoAccessRequestsTable,
      resolverEmail: usersTable.email,
    })
    .from(ssoAccessRequestsTable)
    .leftJoin(
      usersTable,
      eq(usersTable.id, ssoAccessRequestsTable.resolvedByUserId),
    )
    .where(eq(ssoAccessRequestsTable.id, id))
    .limit(1);
  const first = rows[0];
  if (!first) return null;
  return rowToPublic(first.row, first.resolverEmail ?? null);
}

/**
 * Flip the row to handled (or back to pending). The "resolved" vs
 * "dismissed" distinction is purely audit intent today — both just
 * stamp `resolvedAt` + `resolvedByUserId`. Returns null when the row
 * doesn't exist so the route can 404.
 */
export async function updateSsoAccessRequestResolution(input: {
  id: string;
  resolution: "resolved" | "dismissed" | "pending";
  adminUserId: string;
}): Promise<PublicSsoAccessRequest | null> {
  const reopen = input.resolution === "pending";
  const updated = await db
    .update(ssoAccessRequestsTable)
    .set(
      reopen
        ? { resolvedAt: null, resolvedByUserId: null }
        : { resolvedAt: sql`now()`, resolvedByUserId: input.adminUserId },
    )
    .where(eq(ssoAccessRequestsTable.id, input.id))
    .returning({ id: ssoAccessRequestsTable.id });
  if (updated.length === 0) return null;
  return getSsoAccessRequestById(input.id);
}

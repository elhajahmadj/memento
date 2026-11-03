import { desc, eq, isNull, lt } from "drizzle-orm";
import {
  db,
  ssoDenialsTable,
  usersTable,
  type SsoDenial,
} from "@workspace/db";
import { logger } from "@/shared/logger";
import { notifyAdminsOfSsoDenial } from "./ssoDenialNotifier";
import type { SsoDenialGate, PublicSsoDenial } from "./ssoDenialTypes";

export type { SsoDenialGate, PublicSsoDenial } from "./ssoDenialTypes";

type SsoDenialRowWithHandler = SsoDenial & {
  handledByUsername: string | null;
};

const VALID_GATES: readonly SsoDenialGate[] = [
  "no_memento_user",
  "no_memento_access",
  "no_org",
];

const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LIST_LIMIT = 50;

function toPublic(row: SsoDenialRowWithHandler): PublicSsoDenial {
  const gate: SsoDenialGate = (VALID_GATES as readonly string[]).includes(
    row.gate,
  )
    ? (row.gate as SsoDenialGate)
    : "no_org";
  return {
    id: row.id,
    subject: row.subject,
    email: row.email,
    gate,
    orgKey: row.orgKey,
    createdAt: row.createdAt.toISOString(),
    handledAt: row.handledAt ? row.handledAt.toISOString() : null,
    handledByUsername: row.handledByUsername,
  };
}

/**
 * Record an SSO sign-in that was rejected by one of the Nexus claim
 * gates. Best-effort: a database error is logged but never propagates
 * — the SSO callback must still redirect the user to the login page
 * with the right error marker even if the audit write fails.
 */
export async function recordSsoDenial(input: {
  subject: string;
  email: string | null;
  gate: SsoDenialGate;
  orgKey: string | null;
}): Promise<void> {
  let inserted = false;
  try {
    await db.insert(ssoDenialsTable).values({
      subject: input.subject,
      email: input.email,
      gate: input.gate,
      orgKey: input.orgKey,
    });
    inserted = true;
  } catch (err) {
    logger.warn({ err, gate: input.gate }, "Failed to record SSO denial");
  }
  // Fire the admin notification only when the audit row landed. We do
  // not block the SSO callback's redirect on delivery — the notifier
  // is best-effort and swallows its own errors.
  if (inserted) {
    void notifyAdminsOfSsoDenial(input);
  }
}

/**
 * Delete rows older than the retention window so the table doesn't
 * grow unbounded. Best-effort and called lazily from `listRecentSsoDenials`
 * — we never block a request on it. Returns the deleted row count for
 * tests.
 */
export async function pruneOldSsoDenials(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PRUNE_AFTER_MS);
  try {
    const result = await db
      .delete(ssoDenialsTable)
      .where(lt(ssoDenialsTable.createdAt, cutoff))
      .returning({ id: ssoDenialsTable.id });
    return result.length;
  } catch (err) {
    logger.warn({ err }, "Failed to prune SSO denials");
    return 0;
  }
}

/**
 * Return the most recent denials (newest first), capped at
 * `LIST_LIMIT`. Prunes old rows lazily so the table stays bounded.
 *
 * By default only open denials (`handledAt IS NULL`) are returned so the
 * admin queue stays focused on actionable rows. Pass `includeHandled:
 * true` to surface dismissed rows too (used by the "Show handled" toggle).
 */
export async function listRecentSsoDenials(
  opts: { includeHandled?: boolean } = {},
): Promise<PublicSsoDenial[]> {
  await pruneOldSsoDenials();
  const whereClause = opts.includeHandled
    ? undefined
    : isNull(ssoDenialsTable.handledAt);
  const baseQuery = db
    .select({
      id: ssoDenialsTable.id,
      subject: ssoDenialsTable.subject,
      email: ssoDenialsTable.email,
      gate: ssoDenialsTable.gate,
      orgKey: ssoDenialsTable.orgKey,
      createdAt: ssoDenialsTable.createdAt,
      handledAt: ssoDenialsTable.handledAt,
      handledByUserId: ssoDenialsTable.handledByUserId,
      handledByUsername: usersTable.username,
    })
    .from(ssoDenialsTable)
    .leftJoin(usersTable, eq(ssoDenialsTable.handledByUserId, usersTable.id));
  const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(desc(ssoDenialsTable.createdAt))
    .limit(LIST_LIMIT);
  return rows.map(toPublic);
}

/**
 * Toggle the handled state of a denial. When `handled: true` we stamp
 * `handledAt`/`handledByUserId`; when `false` we clear them so the row
 * resurfaces in the default queue. Returns the updated row or null when
 * no matching row exists.
 */
export async function setSsoDenialHandled(input: {
  id: string;
  handled: boolean;
  adminUserId: string;
}): Promise<PublicSsoDenial | null> {
  if (input.handled) {
    await db
      .update(ssoDenialsTable)
      .set({
        handledAt: new Date(),
        handledByUserId: input.adminUserId,
      })
      .where(eq(ssoDenialsTable.id, input.id));
  } else {
    await db
      .update(ssoDenialsTable)
      .set({ handledAt: null, handledByUserId: null })
      .where(eq(ssoDenialsTable.id, input.id));
  }
  const [row] = await db
    .select({
      id: ssoDenialsTable.id,
      subject: ssoDenialsTable.subject,
      email: ssoDenialsTable.email,
      gate: ssoDenialsTable.gate,
      orgKey: ssoDenialsTable.orgKey,
      createdAt: ssoDenialsTable.createdAt,
      handledAt: ssoDenialsTable.handledAt,
      handledByUserId: ssoDenialsTable.handledByUserId,
      handledByUsername: usersTable.username,
    })
    .from(ssoDenialsTable)
    .leftJoin(usersTable, eq(ssoDenialsTable.handledByUserId, usersTable.id))
    .where(eq(ssoDenialsTable.id, input.id))
    .limit(1);
  return row ? toPublic(row) : null;
}

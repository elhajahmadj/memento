import { randomUUID } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import {
  db,
  guestSessionsTable,
  usersTable,
  type GuestSession,
  type User,
} from "@workspace/db";
import { logger } from "@/shared/logger";
import {
  GUEST_SLOT_LOCK_KEY,
  GUEST_TTL_MS,
  MAX_CONCURRENT_GUESTS,
  type CreateGuestSessionResult,
} from "@/features/guest/domain/types";
import {
  deleteProject,
  listAvailableProjects,
} from "@/features/projects/infrastructure/projectService";

/**
 * Lifecycle owner for guest ("Continue as guest") trial identities.
 *
 * A guest is a real `users` row so every downstream consumer
 * (`requireAuth`, `req.user`, `recorded_action_sets`, `audit_events`,
 * the current-project store) keeps working with no branching. What
 * makes it a *guest* is `role = 'guest'` plus a `guest_sessions` row
 * carrying the slot reservation and the hard-delete deadline.
 *
 * Nothing here is best-effort in the way the SSO-denial audit path is:
 * a failure to reap leaves real disk and database residue, so the
 * sweep logs loudly and keeps going rather than aborting the batch.
 */

/**
 * Build the throwaway profile for a new guest. The profile fields are
 * populated (rather than left null) on purpose: `isProfileComplete`
 * gates `/profile/complete` in the SPA, and bouncing a guest into a
 * "finish your profile" form would defeat the point of the flow.
 */
function buildGuestIdentity(): {
  username: string;
  firstName: string;
  lastName: string;
  title: string;
  email: string;
} {
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  return {
    username: `guest-${token}`,
    firstName: "Guest",
    lastName: "User",
    title: "Guest",
    email: `guest-${token}@guest.invalid`,
  };
}

/**
 * Claim one of the {@link MAX_CONCURRENT_GUESTS} slots and mint the
 * backing user row.
 *
 * The count and the insert run inside a single transaction that first
 * takes `pg_advisory_xact_lock`, so simultaneous clicks serialize
 * instead of all reading the same pre-insert count and overshooting the
 * cap. The lock is transaction-scoped and therefore released on commit
 * or rollback with no explicit unlock.
 */
export async function createGuestSession(
  now: Date = new Date(),
): Promise<CreateGuestSessionResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${GUEST_SLOT_LOCK_KEY})`);

    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(guestSessionsTable)
      .where(gt(guestSessionsTable.expiresAt, now));

    if (count >= MAX_CONCURRENT_GUESTS) {
      return { kind: "at_capacity" as const };
    }

    const identity = buildGuestIdentity();
    const [user] = await tx
      .insert(usersTable)
      .values({
        ...identity,
        role: "guest",
        authSource: "guest",
        passwordHash: null,
        // Guests should never see the first-run coachmark tour: it
        // walks through Settings surfaces they cannot reach.
        hasSeenTour: true,
      })
      .returning({ id: usersTable.id });

    if (!user) {
      throw new Error("Failed to create guest user row");
    }

    const expiresAt = new Date(now.getTime() + GUEST_TTL_MS);
    await tx.insert(guestSessionsTable).values({
      userId: user.id,
      projectName: null,
      expiresAt,
    });

    return { kind: "created" as const, userId: user.id, expiresAt };
  });
}

/**
 * Return the caller's guest row when it exists and has not expired.
 * Returns null for non-guests, for unknown users, and — critically —
 * for guests whose deadline has passed but whom the reaper has not yet
 * swept. Callers treat null as "not a valid guest session".
 */
export async function findActiveGuestSession(
  userId: string,
  now: Date = new Date(),
): Promise<GuestSession | null> {
  const [row] = await db
    .select()
    .from(guestSessionsTable)
    .where(
      and(
        eq(guestSessionsTable.userId, userId),
        gt(guestSessionsTable.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Bind the guest's single project to their slot. Returns false when the
 * slot already carries a project name, which is how the
 * one-project-per-guest rule is enforced — the update is conditional on
 * `project_name IS NULL` so two concurrent create requests cannot both
 * succeed.
 */
export async function attachProjectToGuest(
  userId: string,
  projectName: string,
): Promise<boolean> {
  const updated = await db
    .update(guestSessionsTable)
    .set({ projectName })
    .where(
      and(
        eq(guestSessionsTable.userId, userId),
        sql`${guestSessionsTable.projectName} is null`,
      ),
    )
    .returning({ id: guestSessionsTable.id });
  return updated.length > 0;
}

/**
 * Release the project binding without deleting the slot. Used when
 * scaffolding fails after the name was reserved, so the guest is not
 * left holding a slot that points at a project that does not exist.
 */
export async function detachProjectFromGuest(userId: string): Promise<void> {
  await db
    .update(guestSessionsTable)
    .set({ projectName: null })
    .where(eq(guestSessionsTable.userId, userId));
}

export interface GuestReapResult {
  sessionsReaped: number;
  projectsDeleted: number;
  browserSessionsDeleted: number;
}

/**
 * Delete every `user_sessions` row belonging to a user so their browser
 * cookie stops resolving the moment their data is gone. The session
 * store is owned by `connect-pg-simple`, which keeps the payload in an
 * opaque `sess` JSON column — hence the `->>` extraction rather than a
 * typed Drizzle predicate.
 */
async function deleteBrowserSessionsForUser(userId: string): Promise<number> {
  const result = await db.execute(
    sql`delete from user_sessions where sess->>'userId' = ${userId}`,
  );
  return result.rowCount ?? 0;
}

/**
 * Resolve a guest project's on-disk marker path from its solution name.
 * Reuses the same discovery pass the projects list endpoint uses so the
 * reaper cannot drift from the canonical layout rules.
 */
async function findSlnPathForProject(
  projectName: string,
): Promise<string | null> {
  const items = await listAvailableProjects();
  return items.find((p) => p.solutionName === projectName)?.slnPath ?? null;
}

/**
 * Hard-delete every guest whose deadline has passed: the workspace
 * directory, the browser session rows, then the `users` row (which
 * cascades the `guest_sessions` row plus the guest's audit events,
 * recorded action sets, auth states, route mocks, and validation runs).
 *
 * Failures are per-guest: one wedged directory must not stop the rest
 * of the batch from being cleaned up. A guest whose project delete
 * fails keeps its rows so the next sweep retries rather than orphaning
 * the directory forever.
 */
export async function reapExpiredGuests(
  now: Date = new Date(),
): Promise<GuestReapResult> {
  const expired = await db
    .select()
    .from(guestSessionsTable)
    .where(lte(guestSessionsTable.expiresAt, now));

  const result: GuestReapResult = {
    sessionsReaped: 0,
    projectsDeleted: 0,
    browserSessionsDeleted: 0,
  };

  for (const row of expired) {
    try {
      if (row.projectName) {
        const slnPath = await findSlnPathForProject(row.projectName);
        if (slnPath) {
          await deleteProject(slnPath);
          result.projectsDeleted++;
        } else {
          // Already gone (manual cleanup, or a scaffold that never
          // completed). Nothing to delete — fall through and reap the
          // identity so the slot is released.
          logger.warn(
            { guestUserId: row.userId, project: row.projectName },
            "guest reaper: project directory not found; releasing slot anyway",
          );
        }
      }
      result.browserSessionsDeleted += await deleteBrowserSessionsForUser(
        row.userId,
      );
      // Cascades guest_sessions + every per-user sidecar table.
      await db.delete(usersTable).where(eq(usersTable.id, row.userId));
      result.sessionsReaped++;
    } catch (err) {
      logger.error(
        { err, guestUserId: row.userId, project: row.projectName },
        "guest reaper: failed to reap guest; will retry on the next sweep",
      );
    }
  }

  return result;
}

/**
 * How often the in-process reaper re-runs. Deliberately much shorter
 * than the 6h TTL so an expired guest's data is gone within minutes of
 * the deadline rather than hours. The per-request expiry check in
 * `requireAuth` covers the gap in the meantime.
 */
const REAPER_INTERVAL_MS = 5 * 60 * 1000;

let scheduleHandle: NodeJS.Timeout | null = null;

/**
 * Start the reaper: sweeps once immediately, then every
 * {@link REAPER_INTERVAL_MS}. The interval is unref'd so it does not
 * keep the event loop alive on shutdown. Calling more than once is a
 * no-op. Mirrors `startValidationTraceCleanupSchedule`.
 */
export function startGuestReaperSchedule(): void {
  if (scheduleHandle) return;
  const sweep = (): void => {
    reapExpiredGuests().then(
      (r) => {
        if (r.sessionsReaped > 0) {
          logger.info({ ...r }, "guest reaper completed");
        }
      },
      (err) => logger.error({ err }, "guest reaper failed"),
    );
  };
  sweep();
  scheduleHandle = setInterval(sweep, REAPER_INTERVAL_MS);
  scheduleHandle.unref();
}

/** Stop the reaper (intended for tests / graceful shutdown). */
export function stopGuestReaperSchedule(): void {
  if (scheduleHandle) {
    clearInterval(scheduleHandle);
    scheduleHandle = null;
  }
}

/** True when the user row is a guest trial identity. */
export function isGuestUser(user: Pick<User, "role">): boolean {
  return user.role === "guest";
}

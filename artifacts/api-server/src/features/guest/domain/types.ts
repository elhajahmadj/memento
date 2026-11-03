/**
 * Guest ("Continue as guest") domain constants and types.
 *
 * Pure module — no I/O, no database, no Express. Both the service and
 * the tests import the limits from here so there is exactly one place
 * to change them.
 */

/**
 * How long a guest trial lasts before the reaper hard-deletes the
 * project, the throwaway `users` row, and the browser session.
 */
export const GUEST_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Deployment-wide ceiling on simultaneously-active guest slots. This is
 * a global cap, not a per-IP or per-browser one: 30 different people
 * from 30 different sessions fill it just as surely as one person
 * refreshing 30 times. When it is full, `POST /auth/guest` refuses to
 * mint a new identity rather than signing anyone in.
 */
export const MAX_CONCURRENT_GUESTS = 30;

/**
 * Advisory-lock key used to serialize slot acquisition. A plain
 * "count then insert" races: 30 concurrent clicks can each read 29 and
 * each insert, overshooting the cap. Taking a transaction-scoped
 * advisory lock on this constant makes the check-and-insert atomic
 * across every server process sharing the database.
 *
 * The value is arbitrary but must stay stable — changing it while
 * servers are running would let two generations of the code acquire
 * different locks and race with each other.
 */
export const GUEST_SLOT_LOCK_KEY = 0x6d656d67; // "memg"

/** Guests get exactly one project; this is the refusal reason. */
export const GUEST_PROJECT_LIMIT = 1;

/** Outcome of attempting to claim a guest slot. */
export type CreateGuestSessionResult =
  | { kind: "created"; userId: string; expiresAt: Date }
  | { kind: "at_capacity" };

/** Shape returned to the SPA. */
export interface GuestSessionView {
  /** ISO-8601 hard-delete deadline. */
  expiresAt: string;
  /** Solution name of the guest's one project, or null if not created. */
  projectName: string | null;
}

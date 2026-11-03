import { and, eq } from "drizzle-orm";
import { db, authStatesTable, type AuthState } from "@workspace/db";
import { logger } from "@/shared/logger";
import {
  isEncryptedState,
  parseStorageState,
  unwrapState,
  wrapState,
} from "@/features/auth-states/infrastructure/authStateCrypto";

/**
 * Persisted Playwright `storageState()` payload (cookies + localStorage)
 * captured by the workbench's "Capture login" flow. Scoped per-(user,
 * project) so each fork's owner keeps their own logged-in session and
 * cannot see / overwrite another user's state.
 *
 * The payload is encrypted at rest (audit finding H-2) — see
 * `authStateCrypto.ts` for the envelope format and the legacy-plaintext
 * read path. Read it through {@link loadAuthStateStorageState}, which
 * decrypts; `loadAuthStateRow` returns the raw row and is for metadata.
 */

/**
 * Thrown when a captured payload is not a Playwright storageState
 * (audit finding M-8). Routes map this to 400.
 */
export class InvalidAuthStateError extends Error {
  constructor() {
    super("The captured login state is not a valid Playwright storageState.");
    this.name = "InvalidAuthStateError";
  }
}

export interface SavedAuthState {
  hasState: boolean;
  label: string | null;
  updatedAt: string | null;
}

export async function getAuthStateSummary(args: {
  userId: string;
  projectName: string;
}): Promise<SavedAuthState> {
  const row = await loadAuthStateRow(args);
  if (!row) return { hasState: false, label: null, updatedAt: null };
  return {
    hasState: true,
    label: row.label || null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadAuthStateRow(args: {
  userId: string;
  projectName: string;
}): Promise<AuthState | null> {
  const rows = await db
    .select()
    .from(authStatesTable)
    .where(
      and(
        eq(authStatesTable.userId, args.userId),
        eq(authStatesTable.projectName, args.projectName),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Load the decrypted Playwright storageState for a (user, project), or
 * `null` when there is none — or when it cannot be decrypted, which is
 * treated as "no saved login" so recording/replay degrades to an
 * unauthenticated run instead of failing.
 *
 * Prefer this over reading `.state` off {@link loadAuthStateRow}: the
 * column holds ciphertext, so a raw read would hand Playwright an
 * envelope object instead of cookies.
 */
export async function loadAuthStateStorageState(args: {
  userId: string;
  projectName: string;
}): Promise<object | null> {
  const row = await loadAuthStateRow(args);
  if (!row) return null;
  return unwrapState(row.state);
}

export async function saveAuthState(args: {
  userId: string;
  projectName: string;
  label: string;
  state: unknown;
}): Promise<SavedAuthState> {
  // M-8: validate the shape before storing. This was the one write path
  // that accepted arbitrary client-controlled structure. Rejecting here
  // rather than at replay time turns an opaque "saved login doesn't
  // work" into an immediate 400.
  const validated = parseStorageState(args.state);
  if (!validated) {
    throw new InvalidAuthStateError();
  }
  // H-2: encrypted before it touches the database. This payload is the
  // live cookies + localStorage of the system under test, i.e. a
  // replayable credential for a third-party system.
  const encrypted = wrapState(validated);
  await db
    .insert(authStatesTable)
    .values({
      userId: args.userId,
      projectName: args.projectName,
      label: args.label,
      state: encrypted,
    })
    .onConflictDoUpdate({
      target: [authStatesTable.userId, authStatesTable.projectName],
      set: {
        label: args.label,
        state: encrypted,
        updatedAt: new Date(),
      },
    });
  return getAuthStateSummary(args);
}

/**
 * Boot check mirroring `assertEncryptionKeyOnBoot` /
 * `assertRepoPatsEncryptionKeyOnBoot` /
 * `assertUserProjectForksEncryptionKeyOnBoot`: if encrypted auth states
 * exist but the key cannot decrypt them, say so loudly at startup rather
 * than surfacing it later as "saved login stopped working".
 *
 * Unlike the PAT checks this does **not** throw. A PAT that cannot be
 * decrypted breaks Git integration outright, so refusing to boot is
 * right; an undecryptable auth state only costs the user a re-capture,
 * and taking the whole deployment down for that would be a worse
 * outcome than a loud log line.
 */
export async function assertAuthStatesEncryptionKeyOnBoot(): Promise<void> {
  let rows: AuthState[];
  try {
    rows = await db.select().from(authStatesTable).limit(1);
  } catch {
    // Table might not exist yet (pre-`db push`). Nothing to verify.
    return;
  }
  const row = rows[0];
  if (!row) return;
  if (!isEncryptedState(row.state)) {
    logger.warn(
      "Saved auth states are still stored in plaintext from an older build. " +
        "They will be encrypted the next time each user re-captures their login.",
    );
    return;
  }
  if (unwrapState(row.state) === null) {
    logger.error(
      "PROJECT_SECRETS_KEY cannot decrypt the stored auth states. Users will " +
        "need to re-capture their saved logins, or the correct key must be restored.",
    );
  }
}

export async function deleteAuthState(args: {
  userId: string;
  projectName: string;
}): Promise<void> {
  await db
    .delete(authStatesTable)
    .where(
      and(
        eq(authStatesTable.userId, args.userId),
        eq(authStatesTable.projectName, args.projectName),
      ),
    );
}

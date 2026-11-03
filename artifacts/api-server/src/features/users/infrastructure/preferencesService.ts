/**
 * Per-user UI preferences storage. Today this is just the primary-nav
 * layout (`navLayout`), but the service is shaped so future per-user
 * preferences land on the same row.
 *
 * Always scoped to a single user id — callers must pass the
 * authenticated user's own id; the route handler must never accept a
 * user id from the request.
 */
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

export type NavLayout = "top" | "side";

export interface UserPreferences {
  navLayout: NavLayout;
}

const DEFAULT_PREFERENCES: UserPreferences = { navLayout: "top" };

export async function getUserPreferences(
  userId: string,
): Promise<UserPreferences> {
  const rows = await db
    .select({ navLayout: usersTable.navLayout })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return DEFAULT_PREFERENCES;
  return { navLayout: row.navLayout };
}

export async function updateUserPreferences(
  userId: string,
  prefs: UserPreferences,
): Promise<UserPreferences> {
  const rows = await db
    .update(usersTable)
    .set({ navLayout: prefs.navLayout })
    .where(eq(usersTable.id, userId))
    .returning({ navLayout: usersTable.navLayout });
  const row = rows[0];
  if (!row) return prefs;
  return { navLayout: row.navLayout };
}

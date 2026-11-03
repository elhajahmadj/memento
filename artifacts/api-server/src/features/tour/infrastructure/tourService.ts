/**
 * Onboarding-tour state lives on the users table as a single boolean
 * (`hasSeenTour`). New users see the 5-step coachmark tour the first
 * time they sign in; the Help menu can reset the flag so the tour
 * relaunches on demand.
 */
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

export async function getTourState(userId: string): Promise<boolean> {
  const rows = await db
    .select({ hasSeenTour: usersTable.hasSeenTour })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return rows[0]?.hasSeenTour ?? false;
}

export async function setTourSeen(args: {
  userId: string;
  hasSeenTour: boolean;
}): Promise<boolean> {
  const rows = await db
    .update(usersTable)
    .set({ hasSeenTour: args.hasSeenTour })
    .where(eq(usersTable.id, args.userId))
    .returning({ hasSeenTour: usersTable.hasSeenTour });
  return rows[0]?.hasSeenTour ?? args.hasSeenTour;
}

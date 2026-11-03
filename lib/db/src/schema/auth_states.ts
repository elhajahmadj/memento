import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Persisted Playwright `storageState()` payload (cookies + localStorage)
 * captured by the "Capture login" flow. One slot per (user, project) so
 * each fork's owner can preserve their own logged-in session and reuse
 * it as the starting state of subsequent recordings / replays.
 */
export const authStatesTable = pgTable(
  "auth_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    projectName: text("project_name").notNull(),
    /** Optional human label so the toolbar can describe what was captured. */
    label: text("label").notNull().default(""),
    /** Verbatim Playwright storageState JSON: { cookies, origins }. */
    state: jsonb("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    perProjectUnique: uniqueIndex("auth_states_per_project_unique").on(
      t.userId,
      t.projectName,
    ),
  }),
);

export const insertAuthStateSchema = createInsertSchema(authStatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAuthState = z.infer<typeof insertAuthStateSchema>;
export type AuthState = typeof authStatesTable.$inferSelect;

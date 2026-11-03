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
 * Reusable named macros — a saved RecordedAction[] snippet that the
 * recorder can splice into any new recording. Scoped per-(user, project)
 * to respect the per-user fork model: each fork of a project keeps its
 * own library of shared steps so two users editing the same project
 * never see (or stomp on) each other's macros.
 */
export const sharedStepsTable = pgTable(
  "shared_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    projectName: text("project_name").notNull(),
    /** Human-friendly name used in the picker. */
    name: text("name").notNull(),
    /** Optional one-line description shown in the picker / settings. */
    description: text("description").notNull().default(""),
    /** RecordedAction[] payload — opaque to Postgres. */
    actions: jsonb("actions").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    perNameUnique: uniqueIndex("shared_steps_per_name_unique").on(
      t.userId,
      t.projectName,
      t.name,
    ),
  }),
);

export const insertSharedStepSchema = createInsertSchema(sharedStepsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSharedStep = z.infer<typeof insertSharedStepSchema>;
export type SharedStep = typeof sharedStepsTable.$inferSelect;

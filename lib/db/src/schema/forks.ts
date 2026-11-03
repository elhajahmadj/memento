import { pgEnum, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const forkStatusEnum = pgEnum("fork_status", ["pending", "active"]);

export const forksTable = pgTable(
  "forks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    projectName: text("project_name").notNull(),
    forkPath: text("fork_path").notNull(),
    status: forkStatusEnum("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    userProjectUnique: uniqueIndex("forks_user_project_unique").on(
      t.userId,
      t.projectName,
    ),
  }),
);

export const insertForkSchema = createInsertSchema(forksTable).omit({
  id: true,
  requestedAt: true,
  decidedAt: true,
  decidedBy: true,
});

export type InsertFork = z.infer<typeof insertForkSchema>;
export type Fork = typeof forksTable.$inferSelect;
export type ForkStatus = Fork["status"];

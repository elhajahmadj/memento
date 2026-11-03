import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const projectAssignmentsTable = pgTable(
  "project_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    projectName: text("project_name").notNull(),
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    /**
     * Organization the assignment is scoped to. Null for assignments
     * created against unowned (local-user) projects — those keep the
     * pre-org behavior. Set for assignments created against an
     * org-stamped project so future joins keep the org context.
     */
    organizationId: uuid("organization_id").references(
      () => organizationsTable.id,
      { onDelete: "set null" },
    ),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("UQ_project_assignments_user_project").on(
      t.userId,
      t.projectName,
    ),
    index("IDX_project_assignments_project").on(t.projectName),
  ],
);

export const insertProjectAssignmentSchema = createInsertSchema(
  projectAssignmentsTable,
).omit({ id: true, assignedAt: true });

export type InsertProjectAssignment = z.infer<
  typeof insertProjectAssignmentSchema
>;
export type ProjectAssignment = typeof projectAssignmentsTable.$inferSelect;

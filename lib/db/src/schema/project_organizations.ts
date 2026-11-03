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
import { organizationsTable } from "./organizations";

/**
 * Stamps a project (identified by its on-disk solution name) with the
 * organization that owns it. Projects on disk that have no row here
 * are "unowned" and behave the same as before this feature shipped:
 * local users see them; IDP users do not.
 *
 * A row is inserted whenever an IDP user creates a new project — the
 * creator's currently-active org becomes the project's permanent
 * owner. Local-user-created projects do not get a row and remain
 * visible only to local users.
 */
export const projectOrganizationsTable = pgTable(
  "project_organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectName: text("project_name").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("UQ_project_organizations_project").on(t.projectName),
    index("IDX_project_organizations_org").on(t.organizationId),
  ],
);

export const insertProjectOrganizationSchema = createInsertSchema(
  projectOrganizationsTable,
).omit({ id: true, createdAt: true });

export type InsertProjectOrganization = z.infer<
  typeof insertProjectOrganizationSchema
>;
export type ProjectOrganization =
  typeof projectOrganizationsTable.$inferSelect;

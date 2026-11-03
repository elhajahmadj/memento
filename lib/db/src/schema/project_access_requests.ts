import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const accessRequestStatusEnum = pgEnum("access_request_status", [
  "pending",
  "approved",
  "denied",
]);

export const projectAccessRequestsTable = pgTable(
  "project_access_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    projectName: text("project_name").notNull(),
    status: accessRequestStatusEnum("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    /**
     * Organization the request is scoped to. Null for requests against
     * unowned (local-user) projects. Set for requests against an
     * org-stamped project so cross-org leakage stays impossible.
     */
    organizationId: uuid("organization_id").references(
      () => organizationsTable.id,
      { onDelete: "set null" },
    ),
    note: text("note"),
  },
  (t) => [
    index("IDX_access_request_status").on(t.status),
    index("IDX_access_request_user").on(t.userId),
    index("IDX_access_request_project").on(t.projectName),
  ],
);

export const insertProjectAccessRequestSchema = createInsertSchema(
  projectAccessRequestsTable,
).omit({ id: true, requestedAt: true, decidedAt: true });

export type InsertProjectAccessRequest = z.infer<
  typeof insertProjectAccessRequestSchema
>;
export type ProjectAccessRequest =
  typeof projectAccessRequestsTable.$inferSelect;
export type AccessRequestStatus = ProjectAccessRequest["status"];

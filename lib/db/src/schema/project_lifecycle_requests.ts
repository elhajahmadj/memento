import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";
import { userRoleEnum } from "./users";

/**
 * Tracks pending and decided admin-approval requests for project
 * lifecycle changes (create / delete). A dedicated table is used
 * instead of extending `approval_submissions` because that table is
 * tightly coupled to fork-to-main merges (fork id, snapshot path,
 * unique-per-fork constraint) and does not generalize cleanly.
 *
 * `requestedByRole` snapshots the requester's role at request time so
 * the create flow can decide whether an approved request should
 * auto-assign the requester as `user` or `limited_admin` to the
 * newly-created project.
 *
 * `organizationId` is nullable to support local users that have no
 * active org. The delete-flow treats a null org as "no approval
 * needed" to preserve today's behavior for local installs.
 */
export const projectLifecycleRequestKindEnum = pgEnum(
  "project_lifecycle_request_kind",
  ["create", "delete", "clear_files"],
);

export const projectLifecycleRequestStatusEnum = pgEnum(
  "project_lifecycle_request_status",
  ["pending", "approved", "rejected"],
);

export const projectLifecycleRequestsTable = pgTable(
  "project_lifecycle_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectName: text("project_name").notNull(),
    organizationId: uuid("organization_id").references(
      () => organizationsTable.id,
      { onDelete: "cascade" },
    ),
    kind: projectLifecycleRequestKindEnum("kind").notNull(),
    status: projectLifecycleRequestStatusEnum("status")
      .notNull()
      .default("pending"),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    requestedByRole: userRoleEnum("requested_by_role").notNull(),
    language: text("language"),
    solutionType: text("solution_type"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedByUserId: uuid("decided_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
  },
  (t) => [
    index("IDX_project_lifecycle_requests_status").on(t.status),
    index("IDX_project_lifecycle_requests_org_status").on(
      t.organizationId,
      t.status,
    ),
    index("IDX_project_lifecycle_requests_project").on(t.projectName),
  ],
);

export const insertProjectLifecycleRequestSchema = createInsertSchema(
  projectLifecycleRequestsTable,
).omit({
  id: true,
  status: true,
  requestedAt: true,
  decidedByUserId: true,
  decidedAt: true,
  decisionNote: true,
});

export type InsertProjectLifecycleRequest = z.infer<
  typeof insertProjectLifecycleRequestSchema
>;
export type ProjectLifecycleRequest =
  typeof projectLifecycleRequestsTable.$inferSelect;
export type ProjectLifecycleRequestKind =
  ProjectLifecycleRequest["kind"];
export type ProjectLifecycleRequestStatus =
  ProjectLifecycleRequest["status"];

import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const auditActionEnum = pgEnum("audit_action", [
  "file_create",
  "file_save",
  "file_delete",
  "file_rename",
  "folder_create",
  "recording_finalize",
  "approval_submit",
  "approval_approve",
  "approval_reject",
  "fork_create",
  "fork_delete",
  "role_change",
  "project_assignment_create",
  "project_assignment_remove",
  "access_request_create",
  "access_request_approve",
  "access_request_deny",
  "validation_queued",
  "validation_completed",
  "validation_failed",
  "internal_test_run_start",
  "internal_test_run_complete",
  "recorded_action_edit",
  "selector_heal",
  "ai_selector_heal_suggest",
  "user_delete",
  "project_git_pull",
  "project_git_push",
  "project_git_branch_create",
  "project_git_branch_checkout",
  "project_create_requested",
  "project_create_approved",
  "project_create_rejected",
  "project_delete_requested",
  "project_delete_approved",
  "project_delete_rejected",
  "project_delete_executed",
  "project_clear_files_requested",
  "project_clear_files_approved",
  "project_clear_files_rejected",
  "project_clear_files_executed",
  "sso_denial_dismiss",
  "sso_denial_unhandle",
]);

export const auditEventsTable = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    project: text("project"),
    action: auditActionEnum("action").notNull(),
    filePath: text("file_path"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("IDX_audit_events_user_created").on(t.userId, t.createdAt),
    index("IDX_audit_events_project_created").on(t.project, t.createdAt),
  ],
);

export const insertAuditEventSchema = createInsertSchema(auditEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEventsTable.$inferSelect;
export type AuditAction = AuditEvent["action"];

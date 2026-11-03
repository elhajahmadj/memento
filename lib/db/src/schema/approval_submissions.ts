import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { forksTable } from "./forks";

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
]);

export const approvalSubmissionsTable = pgTable(
  "approval_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    forkId: uuid("fork_id")
      .notNull()
      .references(() => forksTable.id, { onDelete: "cascade" }),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: approvalStatusEnum("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    submitterComment: text("submitter_comment"),
    snapshotPath: text("snapshot_path").notNull(),
  },
  (t) => [
    index("IDX_approval_submissions_status").on(t.status),
    index("IDX_approval_submissions_fork").on(t.forkId),
    uniqueIndex("UQ_approval_submissions_pending_per_fork")
      .on(t.forkId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const insertApprovalSubmissionSchema = createInsertSchema(
  approvalSubmissionsTable,
).omit({
  id: true,
  submittedAt: true,
  status: true,
  decidedBy: true,
  decidedAt: true,
  comment: true,
  submitterComment: true,
});

export type InsertApprovalSubmission = z.infer<
  typeof insertApprovalSubmissionSchema
>;
export type ApprovalSubmission =
  typeof approvalSubmissionsTable.$inferSelect;
export type ApprovalStatus = ApprovalSubmission["status"];

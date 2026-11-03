import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * One row per "Validate" invocation. The replay engine writes its progress
 * here so the UI can poll/stream the run and show its final result. A run
 * with `recordingFilePath = null` represents a project-wide "Validate all"
 * invocation that fans out to one child run per recording.
 */
export const validationRunsTable = pgTable(
  "validation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Project / solution name. Always set (we never validate without a project). */
    projectName: text("project_name").notNull(),
    /** Parent run for fan-out children, NULL for top-level runs. */
    parentRunId: uuid("parent_run_id"),
    /**
     * Recording target. NULL for the parent of a "validate all" fan-out;
     * set for any concrete single-recording run.
     */
    recordingFilePath: text("recording_file_path"),
    recordingKind: text("recording_kind", {
      enum: ["beforeEach", "oneTimeSetup", "testMethod", "all"],
    }).notNull(),
    recordingMethodName: text("recording_method_name"),
    /**
     * Lifecycle: queued -> running -> (passed | failed | error).
     * "error" is reserved for infrastructure failures (URL unreachable,
     * browser crash); "failed" means a step's locator/assertion did not
     * match.
     */
    status: text("status", {
      enum: ["queued", "running", "passed", "failed", "error"],
    })
      .notNull()
      .default("queued"),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /**
     * Final summary blob. Step list, durations, error messages, the
     * project-relative path of the final-state screenshot (if any), and
     * for parent runs the IDs of the child runs.
     */
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Project-relative path to the trace .zip on disk (under
     * `<workspace>/.validation-traces/<runId>.zip`). NULL when no trace
     * was produced (e.g. URL-unreachable failures).
     */
    traceRef: text("trace_ref"),
    triggeredByUserId: uuid("triggered_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("IDX_validation_runs_project_queued").on(t.projectName, t.queuedAt),
    index("IDX_validation_runs_parent").on(t.parentRunId),
  ],
);

export const insertValidationRunSchema = createInsertSchema(
  validationRunsTable,
).omit({
  id: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
});

export type InsertValidationRun = z.infer<typeof insertValidationRunSchema>;
export type ValidationRun = typeof validationRunsTable.$inferSelect;
export type ValidationRunStatus = ValidationRun["status"];
export type ValidationRunKind = ValidationRun["recordingKind"];

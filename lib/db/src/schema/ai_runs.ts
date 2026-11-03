import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * One AI Agent run = one submission of a plain-English plan, plus its
 * resulting JSON report and the list of files materialized into the
 * project tree. The per-step records live inline in `report` (jsonb)
 * to keep the schema compact for v1.
 */
export const aiRunsTable = pgTable(
  "ai_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectName: text("project_name").notNull(),
    /** `playwright` | `api` | `unit` */
    kind: text("kind").notNull(),
    /** Suite name chosen by the user (PascalCase). */
    suiteName: text("suite_name").notNull(),
    /** Original plan text submitted by the user. */
    planText: text("plan_text").notNull(),
    /** `pending` | `running` | `succeeded` | `failed` */
    status: text("status").notNull().default("pending"),
    /** Free-form error message when status = `failed`. */
    errorMessage: text("error_message"),
    /** Full JSON report (steps, calls, catalog deltas). */
    report: jsonb("report"),
    /** Relative paths (from project root) of files written during materialization. */
    materializedFiles: jsonb("materialized_files"),
    triggeredByUserId: uuid("triggered_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("IDX_ai_runs_project").on(t.projectName),
    index("IDX_ai_runs_user").on(t.triggeredByUserId),
  ],
);

export const insertAiRunSchema = createInsertSchema(aiRunsTable).omit({
  id: true,
  startedAt: true,
  finishedAt: true,
});

export type InsertAiRun = z.infer<typeof insertAiRunSchema>;
export type AiRun = typeof aiRunsTable.$inferSelect;

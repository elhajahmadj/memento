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
 * Stores the underlying RecordedAction[] for setup hooks
 * (BeforeEachAsync / OneTimeSetUpAsync) AND for individual [Test] methods
 * so the recorder can REPLAY them — either to restore browser state before
 * a new recording (hooks), or to validate an existing recording end-to-end
 * (test methods, used by the in-app Validate feature).
 *
 * The data lives only in the database — never in the solution folder — so
 * it cannot leak into a downloaded solution zip. Generated C# source
 * remains the source of truth for the actual test code; this table is a
 * sidecar used purely for replay.
 */
export const recordedActionSetsTable = pgTable(
  "recorded_action_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /**
     * Owning user. Limited users work in per-user FORKS that share the
     * same `solutionName` ("project name") with other users; without
     * tenant scoping here, two users editing the same class in their
     * own forks would clobber each other's stored hook actions and
     * could even replay another user's data. The unique index includes
     * userId so each fork keeps its own sidecar entry.
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Project / solution name the recording belongs to. */
    projectName: text("project_name").notNull(),
    /** Project-relative path to the test class .cs file. */
    filePath: text("file_path").notNull(),
    /**
     * Which kind of recording these actions belong to. `beforeEach` and
     * `oneTimeSetup` map to the corresponding setup hooks and must have
     * `methodName` NULL. `testMethod` maps to a single [Test] method and
     * must have `methodName` set to the C# method identifier.
     */
    kind: text("kind", {
      enum: ["beforeEach", "oneTimeSetup", "testMethod"],
    }).notNull(),
    /**
     * Method name for `kind = 'testMethod'` recordings; empty string for
     * hooks. The column is NOT NULL with a default of '' so it can be
     * included as-is in the unique index below — Postgres treats multiple
     * NULLs as distinct in unique indexes, which would otherwise let
     * duplicate hook rows accumulate and break upserts.
     */
    methodName: text("method_name").notNull().default(""),
    /** Named URL key from appsettings (Urls:<urlName>). */
    urlName: text("url_name").notNull(),
    /** Concrete start URL captured at record time. Fallback when appsettings is missing the key. */
    startUrl: text("start_url").notNull(),
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
    perRecordingUnique: uniqueIndex(
      "recorded_action_sets_per_recording_unique",
    ).on(t.userId, t.projectName, t.filePath, t.kind, t.methodName),
  }),
);

export const insertRecordedActionSetSchema = createInsertSchema(
  recordedActionSetsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRecordedActionSet = z.infer<
  typeof insertRecordedActionSetSchema
>;
export type RecordedActionSet = typeof recordedActionSetsTable.$inferSelect;
export type RecordedActionSetKind = RecordedActionSet["kind"];

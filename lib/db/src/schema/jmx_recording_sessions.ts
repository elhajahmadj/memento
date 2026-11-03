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
 * Captured HTTP traffic for a JMX recording session.
 *
 * The recorder attaches to a Chromium page via the Chrome DevTools
 * Protocol and records every top-level HTTP request the browser makes
 * during the session. Static asset noise (image / font / stylesheet)
 * is filtered out by default. The ordered `events` JSON array is the
 * raw material that the downstream "JMX XML emitter" slice walks to
 * synthesize JMeter HTTP samplers, header managers, and assertions.
 *
 * One row per session — the table is append-only from the recorder's
 * point of view; emission reads it by `id` (the session id returned by
 * `POST /jmx/recording/start`).
 */
export const jmxRecordingSessionsTable = pgTable(
  "jmx_recording_sessions",
  {
    /** Session id returned by `POST /jmx/recording/start`. */
    id: uuid("id").defaultRandom().primaryKey(),
    /** Owning user — only the caller can stop or read their session. */
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /**
     * Project identifier exactly as supplied by the client. Today the
     * convention is the project's URL-encoded `slnPath`, but the
     * recorder treats it as opaque so this slice does not have to
     * depend on the JMX scaffolder/persistence task shipping first.
     */
    projectId: text("project_id").notNull(),
    /** JMX file the session is recording into (project-relative). */
    jmxFileName: text("jmx_file_name").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Null while the session is still recording. */
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    /** Ordered `JmxHttpEvent[]` payload — opaque to Postgres. */
    events: jsonb("events").notNull().default([]),
  },
  (t) => ({
    byProject: index("jmx_recording_sessions_by_project").on(
      t.userId,
      t.projectId,
      t.jmxFileName,
    ),
  }),
);

export const insertJmxRecordingSessionSchema = createInsertSchema(
  jmxRecordingSessionsTable,
).omit({
  id: true,
  startedAt: true,
  stoppedAt: true,
});

export type InsertJmxRecordingSession = z.infer<
  typeof insertJmxRecordingSessionSchema
>;
export type JmxRecordingSession =
  typeof jmxRecordingSessionsTable.$inferSelect;

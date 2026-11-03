/**
 * Persistence boundary for JMX HTTP recording sessions.
 *
 * Wraps the `jmx_recording_sessions` table so the recorder service
 * does not touch Drizzle directly and so the downstream "JMX XML
 * emitter" slice has a single, narrow read path to consume captured
 * events by session id.
 */
import { and, eq } from "drizzle-orm";
import { db, jmxRecordingSessionsTable } from "@workspace/db";
import type { JmxHttpEvent } from "@/features/jmx/domain/types";
import { sanitizeJmxEvents } from "@/features/jmx/infrastructure/jmxEventSanitizer";

export interface JmxRecordingSessionRecord {
  id: string;
  userId: string;
  projectId: string;
  jmxFileName: string;
  startedAt: Date;
  stoppedAt: Date | null;
  events: JmxHttpEvent[];
}

export async function createSessionRow(args: {
  userId: string;
  projectId: string;
  jmxFileName: string;
}): Promise<string> {
  const [row] = await db
    .insert(jmxRecordingSessionsTable)
    .values({
      userId: args.userId,
      projectId: args.projectId,
      jmxFileName: args.jmxFileName,
      events: [],
    })
    .returning({ id: jmxRecordingSessionsTable.id });
  if (!row) {
    throw new Error("Failed to insert JMX recording session row");
  }
  return row.id;
}

export async function finalizeSessionRow(args: {
  sessionId: string;
  userId: string;
  events: JmxHttpEvent[];
}): Promise<void> {
  // Strip null bytes / lone UTF-16 surrogates before handing the
  // payload to Postgres — captured headers and response bodies
  // (gzipped HTML re-decoded by CDP, binary fragments) routinely
  // carry characters `jsonb` refuses, which previously failed the
  // whole update with a raw Drizzle SQL error. See `jmxEventSanitizer`.
  const sanitized = sanitizeJmxEvents(args.events);
  await db
    .update(jmxRecordingSessionsTable)
    .set({
      events: sanitized as unknown as object,
      stoppedAt: new Date(),
    })
    .where(
      and(
        eq(jmxRecordingSessionsTable.id, args.sessionId),
        eq(jmxRecordingSessionsTable.userId, args.userId),
      ),
    );
}

export async function loadSessionRow(
  sessionId: string,
): Promise<JmxRecordingSessionRecord | null> {
  const rows = await db
    .select()
    .from(jmxRecordingSessionsTable)
    .where(eq(jmxRecordingSessionsTable.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    jmxFileName: row.jmxFileName,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt,
    events: (row.events ?? []) as JmxHttpEvent[],
  };
}

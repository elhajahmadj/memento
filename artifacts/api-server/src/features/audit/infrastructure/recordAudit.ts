import { db, auditEventsTable, type AuditAction, type User } from "@workspace/db";
import { logger } from "@/shared/logger";

export interface RecordAuditInput {
  user: Pick<User, "id">;
  project?: string | null;
  action: AuditAction;
  file?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Persist a single audit event. Errors are logged but never thrown so a
 * failure to write to the audit table cannot take down the originating
 * request (e.g. a successful file save).
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await db.insert(auditEventsTable).values({
      userId: input.user.id,
      project: input.project ?? null,
      action: input.action,
      filePath: input.file ?? null,
      details: input.details ?? {},
    });
  } catch (err) {
    logger.error({ err, action: input.action }, "Failed to record audit event");
  }
}

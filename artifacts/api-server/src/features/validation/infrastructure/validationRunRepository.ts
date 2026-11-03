import { and, eq, inArray, sql } from "drizzle-orm";
import { db, validationRunsTable, type ValidationRunStatus } from "@workspace/db";
import type { ValidationRunRepository } from "../application/ports";

export function createDrizzleValidationRunRepository(): ValidationRunRepository {
  return {
    async insertQueued(args) {
      const [row] = await db
        .insert(validationRunsTable)
        .values({
          projectName: args.projectName,
          parentRunId: args.parentRunId,
          recordingFilePath: args.recordingFilePath,
          recordingKind: args.recordingKind as never,
          recordingMethodName: args.recordingMethodName,
          status: "queued",
          triggeredByUserId: args.triggeredByUserId,
          summary: args.summary,
        })
        .returning();
      if (!row) throw new Error("Failed to insert validation run");
      return { id: row.id };
    },
    async markRunning(runId) {
      await db
        .update(validationRunsTable)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(validationRunsTable.id, runId));
    },
    async finish(args) {
      const [updated] = await db
        .update(validationRunsTable)
        .set({
          status: args.status,
          finishedAt: new Date(),
          summary: args.summary,
          traceRef: args.traceRef,
        })
        .where(eq(validationRunsTable.id, args.runId))
        .returning();
      if (!updated) return null;
      return {
        triggeredByUserId: updated.triggeredByUserId,
        projectName: updated.projectName,
        recordingFilePath: updated.recordingFilePath,
        recordingKind: updated.recordingKind,
        recordingMethodName: updated.recordingMethodName,
      };
    },
    async findActiveForProject(projectName, ignoreRunId) {
      const rows = await db
        .select({ id: validationRunsTable.id })
        .from(validationRunsTable)
        .where(
          and(
            eq(validationRunsTable.projectName, projectName),
            inArray(validationRunsTable.status, ["queued", "running"]),
          ),
        );
      for (const r of rows) {
        if (ignoreRunId && r.id === ignoreRunId) continue;
        return r.id;
      }
      return null;
    },
    async loadSummary(runId) {
      const [row] = await db
        .select({ summary: validationRunsTable.summary })
        .from(validationRunsTable)
        .where(eq(validationRunsTable.id, runId))
        .limit(1);
      return (row?.summary as Record<string, unknown> | undefined) ?? null;
    },
    async findBySessionToken({ projectName, sessionToken }) {
      const rows = await db
        .select({
          id: validationRunsTable.id,
          status: validationRunsTable.status,
        })
        .from(validationRunsTable)
        .where(
          and(
            eq(validationRunsTable.projectName, projectName),
            sql`${validationRunsTable.summary}->>'sessionToken' = ${sessionToken}`,
          ),
        );
      return rows.map((r: { id: string; status: ValidationRunStatus }) => ({
        id: r.id,
        status: r.status,
      }));
    },
    async deleteByIds(ids) {
      if (ids.length === 0) return;
      await db
        .delete(validationRunsTable)
        .where(inArray(validationRunsTable.id, ids));
    },
    async listChildrenOf(parentId) {
      const rows = await db
        .select({
          id: validationRunsTable.id,
          status: validationRunsTable.status,
        })
        .from(validationRunsTable)
        .where(eq(validationRunsTable.parentRunId, parentId));
      return rows.map((r: { id: string; status: ValidationRunStatus }) => ({
        id: r.id,
        status: r.status,
      }));
    },
    async loadParentMeta(parentId) {
      const [row] = await db
        .select({
          triggeredByUserId: validationRunsTable.triggeredByUserId,
          projectName: validationRunsTable.projectName,
          recordingFilePath: validationRunsTable.recordingFilePath,
        })
        .from(validationRunsTable)
        .where(eq(validationRunsTable.id, parentId))
        .limit(1);
      return row ?? null;
    },
    async updateParentRunning({ parentId, plannedChildren, childIds }) {
      await db
        .update(validationRunsTable)
        .set({
          status: "running",
          startedAt: new Date(),
          summary: { plannedChildren, childIds },
        })
        .where(eq(validationRunsTable.id, parentId));
    },
    async finishParent({ parentId, status, summary }) {
      await db
        .update(validationRunsTable)
        .set({
          status,
          finishedAt: new Date(),
          summary,
        })
        .where(eq(validationRunsTable.id, parentId));
    },
  };
}

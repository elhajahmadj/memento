import { and, eq } from "drizzle-orm";
import { db, recordedActionSetsTable } from "@workspace/db";
import {
  loadHookActions,
  loadTestMethodActions,
  loadHooksForClass,
} from "@/features/recording/infrastructure/recordedActionStore";
import type { HookKind, RecordingLoader, RunKind } from "../application/ports";

/** Drizzle-backed adapter for the {@link RecordingLoader} port. */
export function createRecordingLoaderAdapter(): RecordingLoader {
  return {
    loadTestMethodActions,
    loadHookActions: (args) =>
      loadHookActions({ ...args, kind: args.kind as HookKind }),
    loadHooksForClass,
    async listRecordingsForUser({ userId, projectName }) {
      const rows = await db
        .select({
          filePath: recordedActionSetsTable.filePath,
          kind: recordedActionSetsTable.kind,
          methodName: recordedActionSetsTable.methodName,
          userId: recordedActionSetsTable.userId,
        })
        .from(recordedActionSetsTable)
        .where(
          and(
            eq(recordedActionSetsTable.projectName, projectName),
            eq(recordedActionSetsTable.userId, userId),
          ),
        );
      return rows.map((r: typeof rows[number]) => ({
        filePath: r.filePath,
        kind: r.kind as RunKind,
        methodName: r.methodName === "" ? null : r.methodName,
        userId: r.userId,
      }));
    },
  };
}

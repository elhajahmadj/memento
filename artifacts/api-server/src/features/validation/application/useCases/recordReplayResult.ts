import path from "node:path";
import type { ValidationRunStatus } from "@workspace/db";
import type {
  AuditRecorder,
  ReplayEventBus,
  ValidationRunRepository,
} from "../ports";

export interface RecordReplayResultDeps {
  repo: ValidationRunRepository;
  audit: AuditRecorder;
  events: ReplayEventBus;
}

/**
 * Finalize a single replay run: merge session-token tags forward,
 * persist the final summary + trace ref, broadcast `run-finished`, and
 * record an audit entry.
 */
export function makeRecordReplayResult(deps: RecordReplayResultDeps) {
  const { repo, audit, events } = deps;
  return async function recordReplayResult(
    runId: string,
    status: ValidationRunStatus,
    summary: Record<string, unknown>,
  ): Promise<void> {
    const traceFile =
      typeof summary.traceFile === "string" ? summary.traceFile : null;
    const prior = (await repo.loadSummary(runId)) ?? {};
    const mergedSummary: Record<string, unknown> = { ...summary };
    if (typeof prior.source === "string") mergedSummary.source = prior.source;
    if (typeof prior.sessionToken === "string")
      mergedSummary.sessionToken = prior.sessionToken;
    const updated = await repo.finish({
      runId,
      status,
      summary: mergedSummary,
      traceRef: traceFile,
    });
    events.push(runId, { type: "run-finished", status, summary });
    events.markDone(runId);
    if (updated) {
      const action =
        status === "passed" ? "validation_completed" : "validation_failed";
      await audit.record({
        user: { id: updated.triggeredByUserId },
        project: updated.projectName,
        action,
        file: updated.recordingFilePath,
        details: {
          runId,
          kind: updated.recordingKind,
          methodName: updated.recordingMethodName,
          status,
          summary,
        },
      });
    }
  };
}

/** Resolve the absolute path of a run's trace zip, if one exists. */
export function traceZipPathForRun(traceRef: string | null): string | null {
  if (!traceRef) return null;
  return path.join(process.cwd(), ".validation-traces", traceRef);
}

/** Resolve the absolute path of a run's final-state screenshot. */
export function finalScreenshotPathForRun(runId: string): string {
  return path.join(process.cwd(), ".validation-traces", `${runId}-final.png`);
}

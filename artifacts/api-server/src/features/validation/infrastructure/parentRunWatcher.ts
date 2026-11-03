import type { ValidationRunStatus } from "@workspace/db";
import type {
  AuditRecorder,
  ReplayEventBus,
  ValidationRunRepository,
} from "../application/ports";
import { MAX_RUN_DURATION_MS } from "../domain/validationStep";

export interface ParentRunWatcherDeps {
  repo: ValidationRunRepository;
  events: ReplayEventBus;
  audit: AuditRecorder;
}

/**
 * Naive poll loop: check children every second until none are still
 * queued/running, then aggregate into the parent's terminal status.
 */
export function makeWatchParent(deps: ParentRunWatcherDeps) {
  const { repo, events, audit } = deps;
  return async function watchParent(
    parentId: string,
    childIds: string[],
  ): Promise<void> {
    const deadline =
      Date.now() + MAX_RUN_DURATION_MS * (childIds.length + 1);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const rows = await repo.listChildrenOf(parentId);
      const pending = rows.filter(
        (r) => r.status === "queued" || r.status === "running",
      );
      if (pending.length === 0) {
        const failedChildren = rows.filter((r) => r.status === "failed").length;
        const erroredChildren = rows.filter((r) => r.status === "error").length;
        const passedChildren = rows.filter((r) => r.status === "passed").length;
        const plannedChildren = rows.length;
        const status: ValidationRunStatus =
          erroredChildren > 0
            ? "error"
            : failedChildren > 0
              ? "failed"
              : "passed";
        const summaryPayload = {
          childIds,
          passedChildren,
          failedChildren,
          erroredChildren,
          plannedChildren,
        };
        await repo.finishParent({ parentId, status, summary: summaryPayload });
        events.push(parentId, {
          type: "run-finished",
          status,
          summary: {
            passedChildren,
            failedChildren,
            erroredChildren,
            plannedChildren,
          },
        });
        try {
          const parent = await repo.loadParentMeta(parentId);
          if (parent) {
            await audit.record({
              user: { id: parent.triggeredByUserId },
              project: parent.projectName,
              action:
                status === "passed"
                  ? "validation_completed"
                  : "validation_failed",
              file: parent.recordingFilePath,
              details: {
                runId: parentId,
                kind: "all",
                status,
                summary: summaryPayload,
              },
            });
          }
        } catch {
          // Audit failures must never block run completion.
        }
        events.markDone(parentId);
        return;
      }
    }
    // Timed out waiting for children — mark error.
    await repo.finishParent({
      parentId,
      status: "error",
      summary: { error: "Timed out waiting for children" },
    });
    events.push(parentId, {
      type: "run-finished",
      status: "error",
      summary: { error: "Timed out waiting for children" },
    });
    events.markDone(parentId);
  };
}

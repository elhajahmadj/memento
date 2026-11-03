import type { ReplayEventBus, ValidationRunRepository } from "../ports";

export interface CancelRunsDeps {
  repo: ValidationRunRepository;
  events: ReplayEventBus;
  /** Yank any not-yet-started entries out of the in-process FIFO. */
  drainQueueForToken(sessionToken: string): void;
}

/**
 * Cancel + delete every validation run tied to a discarded recording
 * session. Removes still-queued entries from the in-process worker
 * queue, marks any in-flight run for early bail, and DELETEs the
 * matching DB rows so the audit/run history doesn't dangle pointers to
 * a recording that was never saved.
 */
export function makeCancelRunsForSessionToken(deps: CancelRunsDeps) {
  const { repo, events, drainQueueForToken } = deps;
  return async function cancelRunsForSessionToken(
    sessionToken: string,
    projectName: string,
  ): Promise<{ removed: number }> {
    // Yank queued entries out of the in-process FIFO first so the
    // worker can't pick them up between our select and our delete.
    drainQueueForToken(sessionToken);
    const rows = await repo.findBySessionToken({ projectName, sessionToken });
    for (const r of rows) {
      if (r.status === "running" || r.status === "queued") {
        events.markCancelled(r.id);
      }
      events.push(r.id, {
        type: "run-finished",
        status: "error",
        summary: {
          error: "Recording was discarded before this run finished.",
        },
      });
      events.markDone(r.id);
    }
    if (rows.length > 0) {
      await repo.deleteByIds(rows.map((r) => r.id));
    }
    return { removed: rows.length };
  };
}

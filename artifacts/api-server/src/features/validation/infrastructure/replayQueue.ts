import type {
  ReplayEventBus,
  ValidationRunRepository,
  ValidationStartArgs,
} from "../application/ports";

interface QueueEntry {
  runId: string;
  args: ValidationStartArgs;
}

export interface ReplayQueue {
  enqueue(entry: QueueEntry): void;
  drainSessionToken(sessionToken: string): void;
}

export interface ReplayQueueDeps {
  events: ReplayEventBus;
  repo: ValidationRunRepository;
  executeReplay(runId: string, args: ValidationStartArgs): Promise<void>;
}

/**
 * Single-consumer in-process FIFO that drives validation runs through
 * the replay executor. The catch-all here is critical: a bad run must
 * never kill the worker loop or every subsequent run gets stuck.
 */
export function createReplayQueue(deps: ReplayQueueDeps): ReplayQueue {
  const { events, repo, executeReplay } = deps;
  const queue: QueueEntry[] = [];
  let pumping = false;

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        const entry = queue.shift()!;
        try {
          await executeReplay(entry.runId, entry.args);
        } catch (err) {
          await repo
            .finish({
              runId: entry.runId,
              status: "error",
              summary: {
                error: err instanceof Error ? err.message : String(err),
              },
              traceRef: null,
            })
            .catch(() => null);
          events.push(entry.runId, {
            type: "run-finished",
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
          events.markDone(entry.runId);
        }
      }
    } finally {
      pumping = false;
    }
  }

  return {
    enqueue(entry) {
      queue.push(entry);
      void pump();
    },
    drainSessionToken(sessionToken) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const entry = queue[i]!;
        if (entry.args.inlineActions?.sessionToken === sessionToken) {
          queue.splice(i, 1);
        }
      }
    },
  };
}

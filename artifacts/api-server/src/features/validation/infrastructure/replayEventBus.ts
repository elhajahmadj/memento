import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import type { ReplayEventBus } from "../application/ports";

interface RunBuffer {
  runId: string;
  events: unknown[];
  done: boolean;
}

/**
 * In-process replay event bus. Buffers events per run so a websocket
 * client that attaches after a run has already emitted some events
 * still receives the full back-fill before tailing the live stream.
 */
export function createInMemoryEventBus(): ReplayEventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const buffers = new Map<string, RunBuffer>();
  const cancelledRuns = new Set<string>();

  function push(runId: string, event: unknown): void {
    let buf = buffers.get(runId);
    if (!buf) {
      buf = { runId, events: [], done: false };
      buffers.set(runId, buf);
    }
    buf.events.push(event);
    emitter.emit(runId, event);
  }

  function markDone(runId: string): void {
    const buf = buffers.get(runId);
    if (buf) buf.done = true;
    cancelledRuns.delete(runId);
    // Schedule cleanup so old buffers don't accumulate forever — keep
    // them around briefly so a slow client can still pull the tail.
    setTimeout(() => buffers.delete(runId), 5 * 60_000).unref();
  }

  function attach(ws: WebSocket, runId: string): void {
    const buf = buffers.get(runId);
    if (buf) {
      for (const e of buf.events) ws.send(JSON.stringify(e));
      if (buf.done) {
        ws.close();
        return;
      }
    }
    const handler = (event: unknown) => {
      try {
        ws.send(JSON.stringify(event));
      } catch {
        /* socket may have been closed */
      }
      if ((event as { type?: string }).type === "run-finished") ws.close();
    };
    emitter.on(runId, handler);
    const detach = () => emitter.off(runId, handler);
    ws.on("close", detach);
    // M-6: a `ws` socket emitting "error" with no listener is an
    // unhandled EventEmitter error and crashes the process. It also
    // matters for memory: without detaching here, an errored socket
    // leaves its handler registered on `emitter` for the run's lifetime.
    ws.on("error", detach);
  }

  return {
    push,
    attach,
    markDone,
    isCancelled: (runId) => cancelledRuns.has(runId),
    markCancelled: (runId) => cancelledRuns.add(runId),
  };
}

/**
 * Composition root for the validation replay feature.
 *
 * The replay flow used to live in this single 1700-line file. It has
 * been split along Clean Architecture lines:
 *   - `domain/`            — pure step planning + comparison rules.
 *   - `application/ports`  — abstract ports (repo, recordings, audit,
 *                            event bus, reachability, auth state).
 *   - `application/useCases` — one factory per replay phase.
 *   - `infrastructure/`    — concrete adapters (Playwright, Drizzle,
 *                            Express WebSocket, fetch-based probe).
 *
 * This module wires the default production adapters together once at
 * boot, then re-exports the same public surface the rest of the
 * api-server already imports (`enqueueValidationRun`,
 * `enqueueValidateAll`, `attachValidationSocket`, etc.) so callers do
 * not need to change. Tests construct their own deps and call the
 * factories directly instead of importing this barrel.
 */
import { onSessionDiscarded } from "@/features/recording/infrastructure/recordingService";
import { createAuditRecorderAdapter } from "./auditRecorderAdapter";
import { createAuthStateLoaderAdapter } from "./authStateAdapter";
import { createInMemoryEventBus } from "./replayEventBus";
import { createDrizzleValidationRunRepository } from "./validationRunRepository";
import { createRecordingLoaderAdapter } from "./recordingLoaderAdapter";
import { createFetchReachabilityProbe } from "./reachabilityProbe";
import { createReplayQueue } from "./replayQueue";
import { makeExecuteReplay } from "./executeReplay";
import { makeWatchParent } from "./parentRunWatcher";
import {
  ActiveValidationRunError,
  makeEnqueueValidationRun,
} from "../application/useCases/enqueueValidationRun";
import { makeEnqueueValidateAll } from "../application/useCases/enqueueValidateAll";
import { makeCancelRunsForSessionToken } from "../application/useCases/cancelRunsForSessionToken";
import {
  finalScreenshotPathForRun,
  makeRecordReplayResult,
  traceZipPathForRun,
} from "../application/useCases/recordReplayResult";
import type {
  ValidationAllStartArgs,
  ValidationStartArgs,
} from "../application/ports";

export type {
  ValidationStartArgs,
  ValidationAllStartArgs,
} from "../application/ports";
export type {
  ValidationStep,
  ValidationStepStatus,
} from "../domain/validationStep";
export { sanitizeForPath } from "../domain/sanitize";
export { ActiveValidationRunError } from "../application/useCases/enqueueValidationRun";
export {
  traceZipPathForRun,
  finalScreenshotPathForRun,
} from "../application/useCases/recordReplayResult";

// ---- production composition -------------------------------------------------

const events = createInMemoryEventBus();
const repo = createDrizzleValidationRunRepository();
const audit = createAuditRecorderAdapter();
const authStates = createAuthStateLoaderAdapter();
const recordings = createRecordingLoaderAdapter();
const reachability = createFetchReachabilityProbe();

const recordReplayResult = makeRecordReplayResult({ repo, audit, events });

const executeReplay = makeExecuteReplay({
  events,
  recordings,
  authStates,
  reachability,
  finishRun: recordReplayResult,
  markRunning: (runId) => repo.markRunning(runId),
});

const queue = createReplayQueue({ events, repo, executeReplay });

const enqueueValidationRunImpl = makeEnqueueValidationRun({
  repo,
  events,
  schedule: ({ runId, ...args }) =>
    queue.enqueue({ runId, args: args as ValidationStartArgs }),
});

const watchParent = makeWatchParent({ repo, events, audit });

const enqueueValidateAllImpl = makeEnqueueValidateAll({
  repo,
  events,
  audit,
  recordings,
  enqueueOne: (a) => enqueueValidationRunImpl(a),
  watchParent: (parentId, childIds) => {
    watchParent(parentId, childIds).catch(() => {});
  },
});

const cancelRunsForSessionTokenImpl = makeCancelRunsForSessionToken({
  repo,
  events,
  drainQueueForToken: (token) => queue.drainSessionToken(token),
});

// Composition-root accessors. Consumed by `composition/container.ts` so
// route handlers resolve use cases from one place. Held on the same
// module that owns the singleton event bus + queue to avoid duplicating
// in-memory state.
export const validationComposition = {
  enqueueValidationRun: enqueueValidationRunImpl,
  enqueueValidateAll: enqueueValidateAllImpl,
  cancelRunsForSessionToken: cancelRunsForSessionTokenImpl,
  recordReplayResult,
} as const;

// ---- public surface --------------------------------------------------------

export function enqueueValidationRun(args: ValidationStartArgs): Promise<string> {
  return enqueueValidationRunImpl(args);
}

export function enqueueValidateAll(args: ValidationAllStartArgs): Promise<string> {
  return enqueueValidateAllImpl(args);
}

export function cancelRunsForSessionToken(
  sessionToken: string,
  projectName: string,
): Promise<{ removed: number }> {
  return cancelRunsForSessionTokenImpl(sessionToken, projectName);
}

export function attachValidationSocket(
  ws: import("ws").WebSocket,
  runId: string,
): void {
  events.attach(ws, runId);
}

export function isRunCancelled(runId: string): boolean {
  return events.isCancelled(runId);
}

export function markRunCancelled(runId: string): void {
  events.markCancelled(runId);
}

export async function findActiveRunForProject(
  projectName: string,
  ignoreRunId?: string | null,
): Promise<string | null> {
  return repo.findActiveForProject(projectName, ignoreRunId ?? null);
}

void ActiveValidationRunError;
void traceZipPathForRun;
void finalScreenshotPathForRun;

// Wire session-discard cleanup into the recording lifecycle. Registered
// at module load so the very first discard after server start still
// gets cleaned up.
onSessionDiscarded(async (sessionToken, projectName) => {
  await cancelRunsForSessionTokenImpl(sessionToken, projectName).catch(() => {
    /* never let a cleanup failure crash the discard path */
  });
});

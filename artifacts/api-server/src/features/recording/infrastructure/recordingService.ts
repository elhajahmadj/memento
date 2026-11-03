/**
 * Thin barrel for the recording feature's public surface.
 *
 * The original `recordingService.ts` was a single ~4,100 line module
 * holding the in-memory session, WebSocket attach loop, start/stop
 * lifecycle, hook + named-URL helpers, and the per-language finalize
 * code generator. Task #33 extracted the foundation modules into
 * `domain/` and `infrastructure/` siblings; task #75 extracted the
 * remaining `finalize` / `stop` / `stopBrowser` block into
 * `sessionFinalize.ts` and replaced this file with re-exports so the
 * 21 existing import sites (`@/features/recording/infrastructure/
 * recordingService`) keep working without touching call sites.
 */

export type {
  RecordingMetadata,
  RecordingTarget,
  RecordingStatus,
  Session,
  SessionConfig,
  StopCollisionResult,
  StopCompletedResult,
  StopDecision,
  StopResult,
  CurrentSessionInfo,
  StoppedSessionSnapshot,
} from "@/features/recording/domain/sessionTypes";

export {
  deriveSuiteNameFromConfig,
  normalizeNewTestClassName,
} from "@/features/recording/domain/naming";

export {
  onSessionDiscarded,
} from "@/features/recording/infrastructure/sessionState";

export {
  readNamedUrls,
  upsertNamedUrl,
} from "@/features/recording/infrastructure/namedUrls";

export {
  checkHookDefault,
  checkMethodNameCollision,
  getHookState,
  getReplayableHooks,
  type HookStateResult,
  type ReplayableHookInfo,
  type ReplayableHooksResult,
} from "@/features/recording/infrastructure/hookOps";

export { captureAndSaveAuthState } from "@/features/recording/infrastructure/authCapture";

export { start } from "@/features/recording/infrastructure/sessionStart";

export {
  AttachExistingSuiteMissingError,
  attachToOpenBrowser,
  cancelOpenBrowser,
  openBrowser,
  _getSessionActionsForTest,
} from "@/features/recording/infrastructure/openBrowserOps";

export {
  finalize,
  stop,
  stopBrowser,
  SessionOwnershipError,
} from "@/features/recording/infrastructure/sessionFinalize";

export {
  discardSession,
  forceDiscardSession,
  getCurrentSessionInfoForUser,
  getCurrentSessionMetadata,
  getCurrentSessionOwner,
  getStatus,
  getStoppedSessionForUser,
  resolveSessionFilePath,
  shutdown,
} from "@/features/recording/infrastructure/sessionQueries";

export { attachSocket } from "@/features/recording/infrastructure/socket/attachSocket";

export {
  prewarmBrowser,
  releasePrewarmedBrowser,
} from "@/features/recording/infrastructure/prewarmPool";

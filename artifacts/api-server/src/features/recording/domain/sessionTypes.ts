import type { Browser, Page } from "playwright";
import type { WebSocket } from "ws";
import type { Project } from "@/features/projects/domain/types";
import type { RecordedAction } from "@/features/codegen/domain/types";
import type { RecordingMetadata } from "@/features/recording/domain/recordingMetadata";

export type { RecordingMetadata } from "@/features/recording/domain/recordingMetadata";

export type RecordingTarget = "testMethod" | "beforeEach" | "oneTimeSetup";

export interface SessionConfig extends RecordingMetadata {
  startUrl: string;
  urlName: string;
  target: RecordingTarget;
  methodName: string;
  existingTestClassPath?: string | null | undefined;
  newTestClassName?: string | null | undefined;
  overwriteExistingMethod?: boolean | undefined;
  viewport?: { width: number; height: number } | undefined;
  useSavedLogin?: boolean | undefined;
  /**
   * Replay the target class's stored setup-hook actions before
   * recording starts. Defaults to true when omitted so existing
   * clients keep the always-replay behaviour.
   */
  replaySetup?: boolean | undefined;
  captureMode?: boolean | undefined;
  originatedFrom?: "fresh" | "open-browser" | undefined;
  keepBrowserOpen?: boolean | undefined;
  /**
   * Mirrors the runtime `Session.attached` flag onto the config so the
   * pre-attach guard in `start`/`openBrowser` can read it the same way
   * the original recordingService.ts does (e.g.
   * `session.config.attached === false`). Defaults to `undefined` for
   * fully-attached recording sessions.
   */
  attached?: boolean;
}

export interface Session {
  config: SessionConfig;
  project: Project;
  browser: Browser;
  page: Page;
  viewport: { width: number; height: number };
  actions: RecordedAction[];
  sockets: Set<WebSocket>;
  /**
   * Stops the live screencast loop. Replaces the old `frameTimer`
   * handle: the loop is now self-scheduling (see `startScreencast`), so
   * clearing a timer handle is not enough — a frame already in flight
   * would queue the next one after it resolved. Calling this sets the
   * loop's stopped flag as well as clearing its pending timer.
   */
  stopScreencast?: (() => void) | undefined;
  phase: "recording" | "stopped";
  active: boolean;
  assertionLabelIndex: number;
  waitLabelIndex: number;
  lastEditableSelector: string | null;
  lastEditableStrategy: RecordedAction["selectorStrategy"] | null;
  suppressNextChangeFill: { selector: string; value: string } | null;
  lastRenameByIndex: Map<number, string | null>;
  replaying: boolean;
  attached: boolean;
  userId: string;
  sessionToken: string;
}

export interface RecordingStatus {
  active: boolean;
  phase: "idle" | "recording" | "stopped";
  startUrl: string | null;
  methodName: string | null;
  target: RecordingTarget | null;
  targetClass: string | null;
  keepBrowserOpen?: boolean;
}

export type StopDecision =
  | { mode: "overwrite" }
  | { mode: "rename"; methodName: string };

export interface StopCollisionResult {
  status: "collision";
  methodName: string;
  suggestedName: string;
  targetClass: string;
}

export interface StopCompletedResult {
  status: "completed";
  generatedFiles: { path: string; created: boolean }[];
  summary: string;
  hookBackupPath?: string | null;
}

export type StopResult = StopCompletedResult | StopCollisionResult;

export interface CurrentSessionInfo {
  sessionToken: string;
  userId: string;
  projectName: string | null;
  filePath: string | null;
  phase: "recording" | "stopped";
}

export interface StoppedSessionSnapshot {
  sessionToken: string;
  userId: string;
  projectName: string;
  filePath: string;
  kind: RecordingTarget;
  methodName: string | null;
  urlName: string;
  startUrl: string;
  actions: RecordedAction[];
  phase: "stopped";
}

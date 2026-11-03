import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";
import type { Project } from "@/features/projects/infrastructure/projectService";
import type { StoredHookActionSet } from "@/features/recording/infrastructure/recordedActionStore";
import type { ValidationRunStatus } from "@workspace/db";
import type { WebSocket } from "ws";
import type { ValidationStep } from "../domain/validationStep";

export type HookKind = "beforeEach" | "oneTimeSetup";
export type RunKind = HookKind | "testMethod";

export interface ValidationStartArgs {
  userId: string;
  ownerUserId?: string | undefined;
  filePath: string;
  kind: RunKind;
  methodName?: string | null | undefined;
  parentRunId?: string | null | undefined;
  project?: Project | null | undefined;
  inlineActions?: {
    actions: RecordedAction[];
    urlName: string;
    startUrl: string;
    sessionToken: string;
  } | null | undefined;
}

export interface ValidationAllStartArgs {
  userId: string;
  project?: Project | null | undefined;
}

export interface ReachabilityResult {
  ok: boolean;
  status?: number | undefined;
  error?: string | undefined;
}

/** Pre-flight URL reachability check. */
export interface ReachabilityProbe {
  probe(startUrl: string): Promise<ReachabilityResult>;
}

/** Load stored recordings + hooks from the recording store. */
export interface RecordingLoader {
  loadTestMethodActions(args: {
    userId: string;
    projectName: string;
    filePath: string;
    methodName: string;
  }): Promise<StoredHookActionSet | null>;
  loadHookActions(args: {
    userId: string;
    projectName: string;
    filePath: string;
    kind: HookKind;
  }): Promise<StoredHookActionSet | null>;
  loadHooksForClass(args: {
    userId: string;
    projectName: string;
    filePath: string;
  }): Promise<Partial<Record<HookKind, StoredHookActionSet>>>;
  /** List recordings owned by `userId` in `projectName` (for validate-all). */
  listRecordingsForUser(args: {
    userId: string;
    projectName: string;
  }): Promise<
    Array<{
      filePath: string;
      kind: RunKind;
      methodName: string | null;
      userId: string;
    }>
  >;
}

/** Load the saved storageState row for a (user, project) auth slot, if any. */
export interface AuthStateLoader {
  load(args: { userId: string; projectName: string }): Promise<object | null>;
}

/** Persistence port for the `validation_runs` table. */
export interface ValidationRunRepository {
  insertQueued(args: {
    projectName: string;
    parentRunId: string | null;
    recordingFilePath: string | null;
    recordingKind: string;
    recordingMethodName: string | null;
    triggeredByUserId: string;
    summary: Record<string, unknown>;
  }): Promise<{ id: string }>;
  markRunning(runId: string): Promise<void>;
  finish(args: {
    runId: string;
    status: ValidationRunStatus;
    summary: Record<string, unknown>;
    traceRef: string | null;
  }): Promise<{
    triggeredByUserId: string;
    projectName: string;
    recordingFilePath: string | null;
    recordingKind: string;
    recordingMethodName: string | null;
  } | null>;
  findActiveForProject(
    projectName: string,
    ignoreRunId?: string | null,
  ): Promise<string | null>;
  loadSummary(runId: string): Promise<Record<string, unknown> | null>;
  findBySessionToken(args: {
    projectName: string;
    sessionToken: string;
  }): Promise<Array<{ id: string; status: ValidationRunStatus }>>;
  deleteByIds(ids: string[]): Promise<void>;
  listChildrenOf(parentId: string): Promise<
    Array<{ id: string; status: ValidationRunStatus }>
  >;
  loadParentMeta(parentId: string): Promise<{
    triggeredByUserId: string;
    projectName: string;
    recordingFilePath: string | null;
  } | null>;
  updateParentRunning(args: {
    parentId: string;
    plannedChildren: number;
    childIds: string[];
  }): Promise<void>;
  finishParent(args: {
    parentId: string;
    status: ValidationRunStatus;
    summary: Record<string, unknown>;
  }): Promise<void>;
}

/** Recorder for audit log entries. */
export interface AuditRecorder {
  record(args: {
    user: { id: string };
    project: string;
    action: string;
    file?: string | null;
    details?: Record<string, unknown>;
  }): Promise<void>;
}

/** Event bus + websocket subscription for live run telemetry. */
export interface ReplayEventBus {
  push(runId: string, event: unknown): void;
  attach(ws: WebSocket, runId: string): void;
  markDone(runId: string): void;
  isCancelled(runId: string): boolean;
  markCancelled(runId: string): void;
}

/** What a prepared replay knows before the browser is launched. */
export interface PreparedReplay {
  stored: StoredHookActionSet;
  hookSets: Partial<Record<HookKind, StoredHookActionSet>>;
  steps: ValidationStep[];
  storageState: object | null;
  ownerUserId: string;
  project: Project;
}

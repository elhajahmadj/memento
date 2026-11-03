import { customFetch } from "./custom-fetch";

export type ValidationKind =
  | "beforeEach"
  | "oneTimeSetup"
  | "testMethod"
  | "all";

export type ValidationStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "error";

export interface RecordedRecordingDto {
  /**
   * Where this recording came from. "stored" rows live in
   * recordedActionSetsTable; "session" is a synthetic entry for the
   * caller's in-memory STOPPED recording session that hasn't been
   * saved yet.
   */
  source?: "stored" | "session";
  /** True for the unsaved in-memory session entry; false/absent otherwise. */
  unsaved?: boolean;
  filePath: string;
  kind: "beforeEach" | "oneTimeSetup" | "testMethod";
  methodName: string | null;
  urlName: string;
  startUrl: string;
  updatedAt: string;
}

export interface ValidationRunDto {
  id: string;
  projectName: string;
  parentRunId: string | null;
  recordingFilePath: string | null;
  recordingKind: ValidationKind;
  recordingMethodName: string | null;
  status: ValidationStatus;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: Record<string, unknown>;
  traceRef: string | null;
  triggeredByUserId: string;
}

export function listValidationRecordings(): Promise<RecordedRecordingDto[]> {
  return customFetch<RecordedRecordingDto[]>("/api/validation/recordings", {
    method: "GET",
  });
}

export function listValidationRuns(): Promise<ValidationRunDto[]> {
  return customFetch<ValidationRunDto[]>("/api/validation/runs", {
    method: "GET",
  });
}

export function getValidationRun(id: string): Promise<ValidationRunDto> {
  return customFetch<ValidationRunDto>(
    `/api/validation/runs/${encodeURIComponent(id)}`,
    { method: "GET" },
  );
}

export function startValidationRun(args: {
  filePath: string;
  kind: "beforeEach" | "oneTimeSetup" | "testMethod";
  methodName?: string | null;
}): Promise<{ id: string }> {
  return customFetch<{ id: string }>("/api/validation/runs", {
    method: "POST",
    body: JSON.stringify(args),
  });
}

export function startValidationRunFromSession(): Promise<{ id: string }> {
  return customFetch<{ id: string }>("/api/validation/runs", {
    method: "POST",
    body: JSON.stringify({ source: "session" }),
  });
}

export function discardRecordingSession(): Promise<{ discarded: boolean }> {
  return customFetch<{ discarded: boolean }>("/api/recording/discard", {
    method: "POST",
  });
}

export function startValidateAll(): Promise<{ id: string }> {
  return customFetch<{ id: string }>("/api/validation/runs", {
    method: "POST",
    body: JSON.stringify({ all: true }),
  });
}

export function validationTraceUrl(id: string): string {
  return `/api/validation/runs/${encodeURIComponent(id)}/trace`;
}

export function validationScreenshotUrl(id: string): string {
  return `/api/validation/runs/${encodeURIComponent(id)}/screenshot`;
}

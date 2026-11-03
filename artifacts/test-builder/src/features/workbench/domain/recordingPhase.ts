export type RecordingPhase = "idle" | "recording" | "stopped";

export interface RecordingStatusLike {
  phase?: string;
  methodName?: string | null;
  targetClass?: string | null;
}

export interface DerivedRecordingPhase {
  phase: RecordingPhase;
  recording: boolean;
  stopped: boolean;
  sessionLive: boolean;
  /**
   * `/recording/open-browser` sessions are reported as `phase: "recording"`
   * but with both `methodName` and `targetClass` null. A real recording
   * always has a methodName, so the absence of both signals the pre-attach
   * state that drives the open-browser toolbar.
   */
  openBrowserPreAttach: boolean;
}

export function deriveRecordingPhase(
  status: RecordingStatusLike | null | undefined,
): DerivedRecordingPhase {
  const phase: RecordingPhase =
    status?.phase === "recording" || status?.phase === "stopped"
      ? status.phase
      : "idle";
  const recording = phase === "recording";
  const stopped = phase === "stopped";
  const sessionLive = recording || stopped;
  const openBrowserPreAttach =
    recording && !status?.methodName && !status?.targetClass;
  return { phase, recording, stopped, sessionLive, openBrowserPreAttach };
}

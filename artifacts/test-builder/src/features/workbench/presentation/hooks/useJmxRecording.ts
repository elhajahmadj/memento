import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ApiError,
  useArmJmxRecording,
  useStartJmxRecording,
  useStopJmxRecording,
  getGetCurrentProjectQueryKey,
  getGetJmxRecordingStatusQueryKey,
  getGetProjectTreeQueryKey,
} from "@workspace/api-client-react";

/**
 * Best-effort: read a server-supplied `code` field off the error
 * payload. The JMX routes attach short tags like `session_not_found`
 * / `session_not_owned` so the client can pick the right toast
 * without string-matching on `Error.message`.
 */
function errorCode(e: unknown): string | undefined {
  if (e instanceof ApiError) {
    const data = e.data as { code?: unknown } | null;
    if (data && typeof data.code === "string") return data.code;
  }
  return undefined;
}

function errorStatus(e: unknown): number | undefined {
  return e instanceof ApiError ? e.status : undefined;
}

/**
 * Client-side JMX recording session controller.
 *
 * The workbench's JMX session has two distinct phases:
 *
 *   1. **Preview** — a browser session is open and the live canvas is
 *      streaming, but no CDP capture is armed yet. The user can drive
 *      the page (click around, log in, etc.) and nothing is recorded.
 *      Reached by `openPreview` (used by the auto-open-on-create flow)
 *      or by visiting a project with an existing preview session.
 *   2. **Capturing** — CDP `Network.*` listeners are attached and HTTP
 *      events are being persisted. Reached by `armRecording` (promotes
 *      an existing preview) or by `startRecording` (single-shot: opens
 *      browser AND captures, used from the toolbar dialog).
 *
 * Both phases are reflected in the server's status poll
 * (`GET /jmx/recording/status` → `{ sessionId, isCapturing }`). The
 * toolbar uses `isCapturing` to decide whether to show "Start
 * Recording" (preview/idle) or "Stop Recording" (capturing).
 */
export function useJmxRecording(
  projectId: string | null,
  /**
   * Server-authoritative session id from the workbench's status poll.
   * Takes precedence over the locally-cached `sessionId` so a stale
   * local value (after a reload, or after a previous stop failed)
   * can't put the Stop button in a broken state.
   */
  serverSessionId?: string | null,
  /**
   * Server-authoritative capturing flag from the same status poll.
   * `true` only after CDP capture has been armed.
   */
  serverIsCapturing?: boolean,
) {
  const qc = useQueryClient();
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);
  const [localIsCapturing, setLocalIsCapturing] = useState(false);
  const sessionId = serverSessionId ?? localSessionId;
  const isCapturing = serverIsCapturing ?? localIsCapturing;

  // See useJmxRecording.ts in the previous diff for the rationale —
  // start/openPreview mutation callbacks can fire after unmount when
  // the user navigates away while the request is in flight.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const invalidateProject = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetProjectTreeQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetCurrentProjectQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetJmxRecordingStatusQueryKey() }),
    ]);
  }, [qc]);

  const seedStatusCache = useCallback(
    (sid: string, capturing: boolean) => {
      qc.setQueryData(getGetJmxRecordingStatusQueryKey(), {
        sessionId: sid,
        isCapturing: capturing,
      });
    },
    [qc],
  );

  const fireBestEffortStop = useCallback((sid: string) => {
    try {
      fetch("/api/jmx/recording/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        keepalive: true,
        body: JSON.stringify({ sessionId: sid }),
      }).catch(() => {});
    } catch {
      // best effort
    }
  }, []);

  const start = useStartJmxRecording({
    mutation: {
      onSuccess: async (res, vars) => {
        const wasCapture = vars?.data?.capture !== false;
        if (!mountedRef.current) {
          // Navigated away mid-flight — take ownership of the leak.
          fireBestEffortStop(res.sessionId);
          return;
        }
        setLocalSessionId(res.sessionId);
        setLocalIsCapturing(wasCapture);
        seedStatusCache(res.sessionId, wasCapture);
        if (wasCapture) {
          toast.success("JMX recording started");
        }
      },
      onError: (e: Error, vars) => {
        const wasCapture = vars?.data?.capture !== false;
        if (wasCapture) {
          toast.error(e.message ?? "Failed to start JMX recording");
        } else {
          toast.error(e.message ?? "Failed to open recording browser");
        }
      },
    },
  });

  const arm = useArmJmxRecording({
    mutation: {
      onSuccess: async (res) => {
        setLocalIsCapturing(true);
        seedStatusCache(res.sessionId, true);
        toast.success("JMX recording started");
      },
      onError: (e: Error) => {
        // The server returns 404 / code:"session_not_found" when the
        // session referenced by our cached id is gone (crash cleanup,
        // restart, etc.). Surface a clear "browser is no longer
        // open" message instead of the raw error so the user knows
        // to start a new recording from scratch.
        if (errorCode(e) === "session_not_found" || errorStatus(e) === 404) {
          setLocalSessionId(null);
          setLocalIsCapturing(false);
          qc.setQueryData(getGetJmxRecordingStatusQueryKey(), {
            sessionId: null,
            isCapturing: false,
          });
          toast.error(
            "Recording browser is no longer open — start a new recording",
          );
          void invalidateProject();
          return;
        }
        toast.error(e.message ?? "Failed to start JMX recording");
      },
    },
  });

  const stop = useStopJmxRecording({
    mutation: {
      onSuccess: async (res) => {
        setLocalSessionId(null);
        setLocalIsCapturing(false);
        if (res.jmxFilePath) {
          toast.success(
            `Saved ${res.jmxFilePath} (${res.eventCount} request${
              res.eventCount === 1 ? "" : "s"
            })`,
          );
        } else if (res.eventCount > 0) {
          toast.info("Recording stopped, but no .jmx file was written.");
        }
        for (const w of res.warnings ?? []) {
          toast.warning(w, { duration: 8000 });
        }
        await invalidateProject();
      },
      onError: (e: Error) => {
        // Clear local state on every failure so a stale `sessionId`
        // can't keep the Stop button live, repeatedly firing into a
        // session that no longer exists server-side. Also flush the
        // status cache so the toolbar flips back to "no live session"
        // immediately rather than waiting for the next poll.
        setLocalSessionId(null);
        setLocalIsCapturing(false);
        qc.setQueryData(getGetJmxRecordingStatusQueryKey(), {
          sessionId: null,
          isCapturing: false,
        });
        const code = errorCode(e);
        const status = errorStatus(e);
        if (code === "session_not_found" || status === 404) {
          // The most common version of "second-save-400": the server's
          // in-memory session was torn down out-of-band (crash cleanup
          // from page close / browser disconnect) before Save fired.
          toast.error(
            "Recording browser is no longer open — start a new recording",
          );
        } else if (code === "session_not_owned" || status === 403) {
          toast.error(
            "This recording session belongs to another user — refresh to sync",
          );
        } else {
          toast.error(e.message ?? "Failed to stop JMX recording");
        }
        void invalidateProject();
      },
    },
  });

  const openPreview = useCallback(
    (jmxFileName: string, startUrl?: string | null | undefined) => {
      if (!projectId) {
        toast.error("No project loaded");
        return;
      }
      start.mutate({
        data: {
          projectId,
          jmxFileName,
          startUrl: startUrl ?? null,
          capture: false,
        },
      });
    },
    [projectId, start],
  );

  const startRecording = useCallback(
    (jmxFileName: string, startUrl?: string | null | undefined) => {
      if (!projectId) {
        toast.error("No project loaded");
        return;
      }
      // If a preview session is already live, promote it instead of
      // launching a second browser (which would 400 with "already
      // active for this user").
      if (sessionId && !isCapturing) {
        arm.mutate({ data: { sessionId } });
        return;
      }
      start.mutate({
        data: {
          projectId,
          jmxFileName,
          startUrl: startUrl ?? null,
          capture: true,
        },
      });
    },
    [projectId, sessionId, isCapturing, start, arm],
  );

  const stopRecording = useCallback(() => {
    if (!sessionId) return;
    stop.mutate({ data: { sessionId } });
  }, [sessionId, stop]);

  return {
    sessionId,
    /** A session exists (preview or capturing). */
    sessionLive: sessionId !== null,
    /** CDP capture is armed — i.e. actively recording. */
    recording: isCapturing,
    /** A preview-only browser is open but no capture yet. */
    previewActive: sessionId !== null && !isCapturing,
    startPending: start.isPending,
    armPending: arm.isPending,
    stopPending: stop.isPending,
    openPreview,
    startRecording,
    stopRecording,
  };
}

export type UseJmxRecording = ReturnType<typeof useJmxRecording>;

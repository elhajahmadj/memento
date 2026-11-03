import { Router, type IRouter, type Request } from "express";
import {
  ArmJmxRecordingBody,
  ArmJmxRecordingResponse,
  GetJmxRecordingStatusResponse,
  StartJmxRecordingBody,
  StartJmxRecordingResponse,
  StopJmxRecordingBody,
  StopJmxRecordingResponse,
} from "@workspace/api-zod";
import { assertResponseShape } from "@/shared/assertResponseShape";
import {
  armJmxRecording,
  getJmxStatusForUser,
  JmxSessionNotFoundError,
  JmxSessionNotOwnedError,
  startJmxRecording,
  stopJmxRecording,
} from "@/features/jmx/infrastructure/jmxRecordingService";

/**
 * Map a JMX service-layer error to an HTTP status + a short `reason`
 * tag used both in the response body and in the structured log line.
 * Keeping the tags ASCII / kebab-cased so logs can be ripgrep'd by
 * `reason=session_not_found` etc.
 *
 * The "everything else" branch deliberately collapses to a fixed
 * opaque message — historically we returned `err.message`, which on
 * a Drizzle JSONB failure dumped the full `update "jmx_recording_sessions" set …`
 * SQL template and parameter values into the response body (task #25).
 * The underlying error is still captured server-side via
 * `logJmxRouteFailure` at `error` severity, so operators have the
 * full stack to investigate.
 */
export function classifyJmxError(
  err: unknown,
  route: string,
): {
  status: number;
  reason: string;
  message: string;
} {
  if (err instanceof JmxSessionNotFoundError) {
    return { status: 404, reason: "session_not_found", message: err.message };
  }
  if (err instanceof JmxSessionNotOwnedError) {
    return { status: 403, reason: "session_not_owned", message: err.message };
  }
  return {
    status: 500,
    reason: "internal_error",
    message: `Failed to ${route} JMX recording session`,
  };
}

function logJmxRouteFailure(
  req: Request,
  route: string,
  sessionId: string | undefined,
  err: unknown,
  classified: { status: number; reason: string },
): void {
  // 5xx → `error` so the raw Drizzle/SQL details (which we no longer
  // echo to the client) are still captured for operators. 4xx →
  // `warn` because the typed errors are expected (stale session id,
  // wrong owner) and not actionable.
  const payload = {
    sessionId,
    userId: req.user?.id,
    reason: classified.reason,
    status: classified.status,
    err,
  };
  const message = `JMX ${route} failed`;
  if (classified.status >= 500) {
    req.log.error(payload, message);
  } else {
    req.log.warn(payload, message);
  }
}

const router: IRouter = Router();

router.get("/jmx/recording/status", (req, res): void => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const status = getJmxStatusForUser(req.user.id);
  res.json(
    assertResponseShape(
      GetJmxRecordingStatusResponse,
      status,
      "GET /jmx/recording/status",
    ),
  );
});

router.post("/jmx/recording/start", async (req, res): Promise<void> => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = StartJmxRecordingBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn(
      { userId: req.user.id, reason: "zod_parse_failed" },
      "JMX start failed",
    );
    res.status(400).json({ error: parsed.error.message, code: "bad_request" });
    return;
  }
  try {
    const result = await startJmxRecording({
      userId: req.user.id,
      projectId: parsed.data.projectId,
      jmxFileName: parsed.data.jmxFileName,
      startUrl: parsed.data.startUrl ?? null,
      capture: parsed.data.capture ?? true,
    });
    res.json(
      assertResponseShape(
        StartJmxRecordingResponse,
        result,
        "POST /jmx/recording/start",
      ),
    );
  } catch (e) {
    // `startJmxRecording` rejects with plain `Error` for conflicts
    // ("a session is already active", "DOM recording is active"), so
    // keep 400 here — there is no typed-error mapping to do.
    req.log.warn(
      { userId: req.user.id, reason: "start_failed", err: e },
      "JMX start failed",
    );
    res.status(400).json({ error: (e as Error).message, code: "bad_request" });
  }
});

router.post("/jmx/recording/arm", async (req, res): Promise<void> => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = ArmJmxRecordingBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn(
      { userId: req.user.id, reason: "zod_parse_failed" },
      "JMX arm failed",
    );
    res.status(400).json({ error: parsed.error.message, code: "bad_request" });
    return;
  }
  try {
    const result = await armJmxRecording({
      sessionId: parsed.data.sessionId,
      userId: req.user.id,
    });
    res.json(
      assertResponseShape(
        ArmJmxRecordingResponse,
        result,
        "POST /jmx/recording/arm",
      ),
    );
  } catch (e) {
    const classified = classifyJmxError(e, "arm");
    logJmxRouteFailure(req, "arm", parsed.data.sessionId, e, classified);
    res
      .status(classified.status)
      .json({ error: classified.message, code: classified.reason });
  }
});

router.post("/jmx/recording/stop", async (req, res): Promise<void> => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = StopJmxRecordingBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn(
      { userId: req.user.id, reason: "zod_parse_failed" },
      "JMX stop failed",
    );
    res.status(400).json({ error: parsed.error.message, code: "bad_request" });
    return;
  }
  try {
    const result = await stopJmxRecording({
      sessionId: parsed.data.sessionId,
      userId: req.user.id,
    });
    res.json(
      assertResponseShape(
        StopJmxRecordingResponse,
        result,
        "POST /jmx/recording/stop",
      ),
    );
  } catch (e) {
    const classified = classifyJmxError(e, "stop");
    logJmxRouteFailure(req, "stop", parsed.data.sessionId, e, classified);
    res
      .status(classified.status)
      .json({ error: classified.message, code: classified.reason });
  }
});

export default router;

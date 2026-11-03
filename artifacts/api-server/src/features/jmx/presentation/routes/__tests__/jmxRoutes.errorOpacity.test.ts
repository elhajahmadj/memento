/**
 * Presentation-layer regression test for task #25.
 *
 * Before the fix, the JMX stop route surfaced the raw Drizzle error
 * verbatim when the underlying JSONB update rejected the events
 * payload (typically because Chromium captured a `\u0000` in a
 * response header). That dumped the full
 * `update "jmx_recording_sessions" set "stopped_at" = $1, "events" = $2 …`
 * SQL template and its parameter values into the HTTP response body,
 * which the user then saw in the workbench toast.
 *
 * The route now returns a short, opaque message and logs the real
 * error server-side. This test pins that behaviour by feeding the
 * classifier the kind of error Drizzle would actually throw and
 * asserting the response payload is opaque.
 */
import { describe, it, expect } from "vitest";
import { classifyJmxError } from "@/features/jmx/presentation/routes";

describe("classifyJmxError — opaque 500 message", () => {
  it("does not echo the raw Drizzle SQL template into the response payload", () => {
    // Shape of the error message Drizzle throws when the JSONB
    // update is rejected by Postgres — captured verbatim from the
    // original bug report.
    const drizzleErr = new Error(
      `Failed query: update "jmx_recording_sessions" set "stopped_at" = $1, "events" = $2 where ("jmx_recording_sessions"."id" = $3 and "jmx_recording_sessions"."user_id" = $4)
params: 2026-05-22T00:00:00.000Z,[{"headers":{"x-trace":"abc\u0000def"}}],session-id,user-id`,
    );

    const classified = classifyJmxError(drizzleErr, "stop");

    expect(classified.status).toBe(500);
    expect(classified.reason).toBe("internal_error");
    // The fixed opaque message — no SQL, no params.
    expect(classified.message).toBe("Failed to stop JMX recording session");
    expect(classified.message).not.toContain(
      `update "jmx_recording_sessions"`,
    );
    expect(classified.message).not.toContain("$1");
    expect(classified.message).not.toContain("params:");
  });

  it("uses an opaque message for the arm route as well", () => {
    const classified = classifyJmxError(new Error("kaboom"), "arm");
    expect(classified.status).toBe(500);
    expect(classified.message).toBe("Failed to arm JMX recording session");
    expect(classified.message).not.toContain("kaboom");
  });

  it("still preserves the typed not-found / not-owned messages (4xx, no opacity needed)", async () => {
    const { JmxSessionNotFoundError, JmxSessionNotOwnedError } = await import(
      "@/features/jmx/infrastructure/jmxRecordingService"
    );
    expect(
      classifyJmxError(new JmxSessionNotFoundError(), "stop"),
    ).toMatchObject({ status: 404, reason: "session_not_found" });
    expect(
      classifyJmxError(new JmxSessionNotOwnedError(), "stop"),
    ).toMatchObject({ status: 403, reason: "session_not_owned" });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, jmxRecordingSessionsTable, usersTable } from "@workspace/db";
import {
  armJmxRecording,
  JmxSessionNotFoundError,
  JmxSessionNotOwnedError,
  stopJmxRecording,
  _peekJmxStateForTests,
  _resetJmxRecordingStateForTests,
  _seedJmxSessionForTests,
  _simulateCrashCleanupForTests,
} from "@/features/jmx/infrastructure/jmxRecordingService";
import { createSessionRow } from "@/features/jmx/infrastructure/jmxRecordingStore";
import { hashPassword } from "@/features/auth/infrastructure/passwordHash";

/**
 * Regression tests for task #7 (fix JMX second-recording save 400).
 *
 * Cover:
 *  1. Back-to-back start → stop cycles for the same user/project leave
 *     `sessions` / `currentByUser` empty between cycles. The original
 *     bug was that a second cycle's stop returned 400 because the
 *     session entry was already gone — typed errors + map-cleanup
 *     invariants are what guarantee a clean second save.
 *  2. After `crashCleanup` (browser X'd / disconnected) the next stop
 *     throws `JmxSessionNotFoundError` (which the route maps to 404
 *     + `code: "session_not_found"`), not a generic 400.
 *  3. A stop call from the wrong user throws `JmxSessionNotOwnedError`
 *     (which the route maps to 403).
 *
 * Browser orchestration is stubbed via the `_seedJmxSessionForTests`
 * test seam so the suite doesn't have to launch real Chromium twice;
 * the launch / CDP wiring is covered separately by the higher-level
 * E2E suite, see docs/E2E_TESTS.md.
 */
describe("jmxRecordingService — stop error mapping & back-to-back cycles", () => {
  let userId: string;
  const projectId = "ws%2Fdemo-jmx-project";
  const jmxFileName = "recording-1.jmx";

  beforeEach(async () => {
    _resetJmxRecordingStateForTests();
    const passwordHash = await hashPassword("Sup3rSecret!");
    await db
      .delete(usersTable)
      .where(eq(usersTable.username, "jmx-stop-test-user"));
    const [u] = await db
      .insert(usersTable)
      .values({
        username: "jmx-stop-test-user",
        passwordHash,
        role: "limited",
        profile: {},
      })
      .returning();
    if (!u) throw new Error("failed to seed user");
    userId = u.id;
  });

  afterEach(async () => {
    _resetJmxRecordingStateForTests();
    await db
      .delete(jmxRecordingSessionsTable)
      .where(eq(jmxRecordingSessionsTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  it("stopJmxRecording throws JmxSessionNotFoundError for an unknown sessionId", async () => {
    await expect(
      stopJmxRecording({
        sessionId: "00000000-0000-0000-0000-000000000000",
        userId,
      }),
    ).rejects.toBeInstanceOf(JmxSessionNotFoundError);
  });

  it("armJmxRecording throws JmxSessionNotFoundError for an unknown sessionId", async () => {
    await expect(
      armJmxRecording({
        sessionId: "00000000-0000-0000-0000-000000000000",
        userId,
      }),
    ).rejects.toBeInstanceOf(JmxSessionNotFoundError);
  });

  it("stopJmxRecording throws JmxSessionNotOwnedError when caller is not the owner", async () => {
    const sid = await createSessionRow({ userId, projectId, jmxFileName });
    _seedJmxSessionForTests({
      sessionId: sid,
      userId,
      projectId,
      jmxFileName,
      isCapturing: false,
    });
    await expect(
      stopJmxRecording({
        sessionId: sid,
        userId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toBeInstanceOf(JmxSessionNotOwnedError);
  });

  it("after crashCleanup, the next stop call returns the typed not-found error (not a 400)", async () => {
    const sid = await createSessionRow({ userId, projectId, jmxFileName });
    _seedJmxSessionForTests({
      sessionId: sid,
      userId,
      projectId,
      jmxFileName,
      isCapturing: true,
    });
    // Simulate the recorder browser being X'd: page.on("close") /
    // browser.on("disconnected") would have fired and the session
    // gets reaped silently.
    _simulateCrashCleanupForTests(sid);

    await expect(
      stopJmxRecording({ sessionId: sid, userId }),
    ).rejects.toBeInstanceOf(JmxSessionNotFoundError);

    const state = _peekJmxStateForTests();
    expect(state.sessionIds).toEqual([]);
    expect(state.userIds).toEqual([]);
  });

  it("finalizes a session whose events carry JSONB-hostile chars (null byte in a header, lone surrogate in a body)", async () => {
    // Task #25: a stop with auto-captured traffic that contains a
    // `\u0000` in a header value (Chromium does that on some
    // responses) used to fail the DB update with `unsupported
    // Unicode escape sequence … \u0000 cannot be converted to text`.
    // The sanitiser hooked into `finalizeSessionRow` now scrubs both
    // null bytes and lone UTF-16 surrogates to U+FFFD so the row
    // persists and the route returns 200.
    const sid = await createSessionRow({ userId, projectId, jmxFileName });
    _seedJmxSessionForTests({
      sessionId: sid,
      userId,
      projectId,
      jmxFileName,
      isCapturing: false,
      events: [
        {
          method: "GET",
          url: "https://www.google.com/",
          headers: {
            "x-trace": "abc\u0000def",
            "content-type": "text/html",
          },
          contentType: "text/html",
          bodyText: "",
          statusCode: 200,
          responseBody: `<html>${String.fromCharCode(0xd800)}</html>`,
          timestamp: Date.now(),
        },
      ],
    });

    await expect(
      stopJmxRecording({ sessionId: sid, userId }),
    ).resolves.toMatchObject({ sessionId: sid });

    const [row] = await db
      .select()
      .from(jmxRecordingSessionsTable)
      .where(eq(jmxRecordingSessionsTable.id, sid));
    expect(row?.stoppedAt).not.toBeNull();
    const persisted = (row?.events ?? []) as Array<{
      headers: Record<string, string>;
      responseBody: string;
    }>;
    expect(persisted).toHaveLength(1);
    // Null byte and lone surrogate both replaced with U+FFFD.
    expect(persisted[0]!.headers["x-trace"]).toBe("abc\uFFFDdef");
    expect(persisted[0]!.responseBody).toBe("<html>\uFFFD</html>");
  });

  it("two back-to-back start → stop cycles leave in-memory state clean between cycles", async () => {
    // First cycle: seed → stop. The stop path tears the session out
    // of both maps, finalizes the DB row, and (because no events
    // were captured) skips JMX emission.
    const firstId = await createSessionRow({
      userId,
      projectId,
      jmxFileName,
    });
    _seedJmxSessionForTests({
      sessionId: firstId,
      userId,
      projectId,
      jmxFileName,
      isCapturing: false,
    });

    const first = await stopJmxRecording({ sessionId: firstId, userId });
    expect(first.sessionId).toBe(firstId);

    const between = _peekJmxStateForTests();
    expect(between.sessionIds).toEqual([]);
    expect(between.userIds).toEqual([]);

    // Second cycle: a fresh session for the same user/project must
    // succeed cleanly. This is the exact scenario that was 400-ing
    // before task #7's fix — the second stop landed on the wrong
    // branch and surfaced a generic 400.
    const secondId = await createSessionRow({
      userId,
      projectId,
      jmxFileName: "recording-2.jmx",
    });
    _seedJmxSessionForTests({
      sessionId: secondId,
      userId,
      projectId,
      jmxFileName: "recording-2.jmx",
      isCapturing: false,
    });

    const second = await stopJmxRecording({ sessionId: secondId, userId });
    expect(second.sessionId).toBe(secondId);

    const after = _peekJmxStateForTests();
    expect(after.sessionIds).toEqual([]);
    expect(after.userIds).toEqual([]);

    // Both DB rows were finalized — `stoppedAt` is set so the
    // historical record is closed for both cycles.
    const rows = await db
      .select()
      .from(jmxRecordingSessionsTable)
      .where(eq(jmxRecordingSessionsTable.userId, userId));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.stoppedAt).not.toBeNull();
    }
  });
});

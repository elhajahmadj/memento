/**
 * Lifecycle integration test for task #16 — JMX storageState persistence.
 *
 * Wires the JMX recording service's stop path to a stub
 * `JmxAuthStateCapturer` and asserts:
 *
 *   1. When the project marker has `bff: true`, a successful stop
 *      writes an `auth_states` row keyed by (userId, solutionName)
 *      with the verbatim capturer output. The row's `label` carries
 *      the session id so the picker can attribute it to JMX.
 *   2. When the marker has `bff: false`, no row is written and the
 *      capturer is never invoked (today's behavior for non-BFF
 *      JMX projects must be preserved).
 *   3. A preview-only (never-armed) session writes nothing even when
 *      the project is BFF — there's nothing captured to persist.
 *
 * The capturer + browser are stubbed via the existing
 * `_seedJmxSessionForTests` / `setJmxAuthStateCapturerForTests`
 * test seams so the suite doesn't have to launch a real Chromium.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import {
  authStatesTable,
  db,
  jmxRecordingSessionsTable,
  usersTable,
} from "@workspace/db";
import { isEncryptedState } from "@/features/auth-states/infrastructure/authStateCrypto";
import { loadAuthStateStorageState } from "@/features/auth-states/infrastructure/authStateService";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  JMX_PROJECT_FILE,
  PROJECT_MARKER_FILE,
} from "@/features/projects/domain/paths";
import type { ProjectMarker } from "@/features/projects/domain/types";
import {
  setJmxAuthStateCapturerForTests,
  stopJmxRecording,
  _resetJmxRecordingStateForTests,
  _seedJmxSessionForTests,
} from "@/features/jmx/infrastructure/jmxRecordingService";
import { createSessionRow } from "@/features/jmx/infrastructure/jmxRecordingStore";
import { hashPassword } from "@/features/auth/infrastructure/passwordHash";

const SOLUTION = "BffJmxProj";
const PAGE_URL = "https://bff.example.com/dashboard";

async function writeMarker(rootPath: string, marker: ProjectMarker) {
  await fs.mkdir(rootPath, { recursive: true });
  await fs.writeFile(path.join(rootPath, JMX_PROJECT_FILE), "", "utf8");
  await fs.writeFile(
    path.join(rootPath, PROJECT_MARKER_FILE),
    JSON.stringify(marker, null, 2),
    "utf8",
  );
}

function makeMarker(bff: boolean): ProjectMarker {
  return {
    architectureId: "jmx",
    testProjectName: SOLUTION,
    namespace: SOLUTION,
    solutionName: SOLUTION,
    language: "jmx",
    targetUrl: "https://bff.example.com",
    jwtAuth: false,
    bff,
    jmxFiles: [],
  };
}

describe("stopJmxRecording — BFF storageState capture (task #16)", () => {
  let tmp: string;
  let originalWorkspace: string;
  let userId: string;
  let projectId: string;
  let projectRoot: string;

  beforeEach(async () => {
    _resetJmxRecordingStateForTests();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "jmx-auth-cap-"));
    originalWorkspace = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;

    projectRoot = path.join(tmp, SOLUTION);
    // projectId is the URL-encoded slnPath, matching production wiring.
    projectId = encodeURIComponent(
      path.join(projectRoot, JMX_PROJECT_FILE),
    );

    const passwordHash = await hashPassword("Sup3rSecret!");
    await db
      .delete(usersTable)
      .where(eq(usersTable.username, "jmx-auth-cap-user"));
    const [u] = await db
      .insert(usersTable)
      .values({
        username: "jmx-auth-cap-user",
        passwordHash,
        role: "limited",
        profile: {},
      })
      .returning();
    if (!u) throw new Error("failed to seed user");
    userId = u.id;
  });

  afterEach(async () => {
    setJmxAuthStateCapturerForTests(null);
    _resetJmxRecordingStateForTests();
    recorderConfig.workspaceDir = originalWorkspace;
    await fs.rm(tmp, { recursive: true, force: true });
    await db.delete(authStatesTable).where(eq(authStatesTable.userId, userId));
    await db
      .delete(jmxRecordingSessionsTable)
      .where(eq(jmxRecordingSessionsTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  it("writes an auth_states row when the project marker has bff: true", async () => {
    await writeMarker(projectRoot, makeMarker(true));

    const captured = {
      cookies: [
        {
          name: "session",
          value: "live-jwt",
          domain: "bff.example.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax" as const,
        },
      ],
      origins: [
        {
          origin: "https://bff.example.com",
          localStorage: [{ name: "user", value: "alice" }],
        },
      ],
    };
    const capture = vi.fn().mockResolvedValue(captured);
    setJmxAuthStateCapturerForTests({ capture });

    const sid = await createSessionRow({
      userId,
      projectId,
      jmxFileName: "recording-1.jmx",
    });
    _seedJmxSessionForTests({
      sessionId: sid,
      userId,
      projectId,
      jmxFileName: "recording-1.jmx",
      isCapturing: true,
      page: { url: () => PAGE_URL },
    });

    await stopJmxRecording({ sessionId: sid, userId });

    expect(capture).toHaveBeenCalledTimes(1);
    const ctxArg = capture.mock.calls[0]?.[1] as { currentUrl: string | null };
    expect(ctxArg.currentUrl).toBe(PAGE_URL);

    const rows = await db
      .select()
      .from(authStatesTable)
      .where(
        and(
          eq(authStatesTable.userId, userId),
          eq(authStatesTable.projectName, SOLUTION),
        ),
      );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("expected auth_states row");
    expect(row.label).toBe(`JMX session ${sid}`);
    // H-2: the column holds AES-256-GCM ciphertext now, so a plain DB
    // read must not reveal the captured cookies. The round-trip is
    // asserted through the decrypting read path instead.
    expect(isEncryptedState(row.state)).toBe(true);
    expect(
      await loadAuthStateStorageState({ userId, projectName: SOLUTION }),
    ).toEqual(captured);
  });

  it("does not capture or persist when the project marker has bff: false", async () => {
    await writeMarker(projectRoot, makeMarker(false));

    const capture = vi.fn().mockResolvedValue({ cookies: [], origins: [] });
    setJmxAuthStateCapturerForTests({ capture });

    const sid = await createSessionRow({
      userId,
      projectId,
      jmxFileName: "recording-1.jmx",
    });
    _seedJmxSessionForTests({
      sessionId: sid,
      userId,
      projectId,
      jmxFileName: "recording-1.jmx",
      isCapturing: true,
      page: { url: () => PAGE_URL },
    });

    await stopJmxRecording({ sessionId: sid, userId });

    expect(capture).not.toHaveBeenCalled();
    const rows = await db
      .select()
      .from(authStatesTable)
      .where(eq(authStatesTable.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("does not capture for a preview-only (never-armed) session even on a BFF project", async () => {
    await writeMarker(projectRoot, makeMarker(true));

    const capture = vi.fn().mockResolvedValue({ cookies: [], origins: [] });
    setJmxAuthStateCapturerForTests({ capture });

    const sid = await createSessionRow({
      userId,
      projectId,
      jmxFileName: "recording-1.jmx",
    });
    _seedJmxSessionForTests({
      sessionId: sid,
      userId,
      projectId,
      jmxFileName: "recording-1.jmx",
      isCapturing: false,
      page: { url: () => PAGE_URL },
    });

    await stopJmxRecording({ sessionId: sid, userId });

    expect(capture).not.toHaveBeenCalled();
    const rows = await db
      .select()
      .from(authStatesTable)
      .where(eq(authStatesTable.userId, userId));
    expect(rows).toHaveLength(0);
  });
});

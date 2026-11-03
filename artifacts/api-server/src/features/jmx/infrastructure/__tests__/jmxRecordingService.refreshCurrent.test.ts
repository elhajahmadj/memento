/**
 * Regression test for task #50 — JMX file list stays empty after a
 * recording stops.
 *
 * The bug: `writeJmxFile` appends the emitted relative path to
 * `.testbuilder.json#jmxFiles` on disk, but the api-server's
 * `currentProjectStore` holds a snapshot of the project taken at
 * `loadProject` time. The workbench's "JMX files" panel reads from
 * `GET /api/projects/current`, which reads from that in-memory
 * snapshot, so the freshly-emitted plan stayed invisible until the
 * user reloaded or switched projects.
 *
 * The fix: after `writeJmxFile` succeeds, `stopJmxRecording` re-reads
 * `jmxFiles` from the marker and rewrites the cached current-project
 * for the recording's user. This test exercises that path end-to-end
 * (real fs, real marker, real cache mutation — the only thing stubbed
 * out is the recorder browser/CDP).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, jmxRecordingSessionsTable, usersTable } from "@workspace/db";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  JMX_PROJECT_FILE,
  PROJECT_MARKER_FILE,
} from "@/features/projects/domain/paths";
import type { Project, ProjectMarker } from "@/features/projects/domain/types";
import {
  getCurrentProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/repositories/currentProjectStore";
import {
  stopJmxRecording,
  _resetJmxRecordingStateForTests,
  _seedJmxSessionForTests,
} from "@/features/jmx/infrastructure/jmxRecordingService";
import { createSessionRow } from "@/features/jmx/infrastructure/jmxRecordingStore";
import { hashPassword } from "@/features/auth/infrastructure/passwordHash";

const SOLUTION = "JmxCacheRefreshProj";

async function writeMarker(rootPath: string, marker: ProjectMarker) {
  await fs.mkdir(rootPath, { recursive: true });
  await fs.writeFile(path.join(rootPath, JMX_PROJECT_FILE), "", "utf8");
  await fs.writeFile(
    path.join(rootPath, PROJECT_MARKER_FILE),
    JSON.stringify(marker, null, 2),
    "utf8",
  );
}

describe("stopJmxRecording — refreshes current-project jmxFiles cache (task #50)", () => {
  let tmp: string;
  let originalWorkspace: string;
  let userId: string;
  let projectId: string;
  let projectRoot: string;

  beforeEach(async () => {
    _resetJmxRecordingStateForTests();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "jmx-refresh-cur-"));
    originalWorkspace = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;
    projectRoot = path.join(tmp, SOLUTION);
    projectId = encodeURIComponent(path.join(projectRoot, JMX_PROJECT_FILE));

    const passwordHash = await hashPassword("Sup3rSecret!");
    await db
      .delete(usersTable)
      .where(eq(usersTable.username, "jmx-refresh-cur-user"));
    const [u] = await db
      .insert(usersTable)
      .values({
        username: "jmx-refresh-cur-user",
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
    setCurrentProject(null, userId);
    recorderConfig.workspaceDir = originalWorkspace;
    await fs.rm(tmp, { recursive: true, force: true });
    await db
      .delete(jmxRecordingSessionsTable)
      .where(eq(jmxRecordingSessionsTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  it("updates the cached current-project's jmxFiles after a successful emit", async () => {
    await writeMarker(projectRoot, {
      architectureId: "jmx",
      testProjectName: SOLUTION,
      namespace: SOLUTION,
      solutionName: SOLUTION,
      language: "jmx",
      targetUrl: "https://example.com",
      jwtAuth: false,
      bff: false,
      jmxFiles: [],
    });

    // Seed the in-memory current-project the same way `loadProject`
    // would have — empty jmxFiles list, rootPath pointing at the
    // project we're about to write into.
    const cached: Project = {
      solutionName: SOLUTION,
      testProjectName: SOLUTION,
      namespace: SOLUTION,
      rootPath: projectRoot,
      slnPath: path.join(projectRoot, JMX_PROJECT_FILE),
      language: "jmx",
      jmxFiles: [],
      targetUrl: "https://example.com",
    };
    setCurrentProject(cached, userId);

    const jmxFileName = "recording-1.jmx";
    const sid = await createSessionRow({ userId, projectId, jmxFileName });
    _seedJmxSessionForTests({
      sessionId: sid,
      userId,
      projectId,
      jmxFileName,
      isCapturing: true,
      events: [
        {
          method: "GET",
          url: "https://example.com/api/x",
          headers: { "content-type": "application/json" },
          contentType: "application/json",
          bodyText: "",
          statusCode: 200,
          responseBody: "{}",
          timestamp: Date.now(),
        },
      ],
    });

    const result = await stopJmxRecording({ sessionId: sid, userId });
    expect(result.jmxFilePath).toBe("jmx/recording-1.jmx");

    // The marker on disk reflects the new file…
    const markerRaw = await fs.readFile(
      path.join(projectRoot, PROJECT_MARKER_FILE),
      "utf8",
    );
    const marker = JSON.parse(markerRaw) as ProjectMarker;
    expect(marker.jmxFiles).toEqual(["jmx/recording-1.jmx"]);

    // …and so does the in-memory cache the `/api/projects/current`
    // route reads from. This is the assertion that was failing
    // before the fix — the cache held the snapshot from
    // `loadProject` time with an empty `jmxFiles` array.
    const refreshed = getCurrentProject(userId);
    expect(refreshed?.jmxFiles).toEqual(["jmx/recording-1.jmx"]);
    // Other project fields survive unchanged — we only swap jmxFiles.
    expect(refreshed?.solutionName).toBe(SOLUTION);
    expect(refreshed?.rootPath).toBe(projectRoot);
  });
});

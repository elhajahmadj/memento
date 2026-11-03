/**
 * Integration test for `enqueueValidateAll`: confirms the parent
 * `validation_runs` row is inserted with `recordingKind:"all"` and that
 * a child run is enqueued for each recorded action set in the caller's
 * fork of the loaded project.
 *
 * The child runs spawn background playwright work that we deliberately
 * make fail fast (unreachable startUrl `http://127.0.0.1:1`). We don't
 * await them — we only verify the row insertions that happen
 * synchronously before `enqueueValidateAll` returns.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  bootServer,
  deleteUserByUsername,
  provisionUser,
} from "@/shared/test-helpers";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  createProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import { saveActionSet } from "@/features/recording/infrastructure/recordedActionStore";
import {
  attachValidationSocket,
  enqueueValidateAll,
  enqueueValidationRun,
} from "@/features/validation/infrastructure/replayService";
import { db, validationRunsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { WebSocket } from "ws";

let close: () => Promise<void>;
let tmp: string;
let originalWorkspace: string;
let userId = "";

const USERNAME = "vitest-replay-validate-all";

beforeAll(async () => {
  ({ close } = await bootServer());
  const u = await provisionUser({ username: USERNAME, role: "admin" });
  userId = u.id;
});

afterAll(async () => {
  await deleteUserByUsername(USERNAME);
  await close();
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-valall-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  setCurrentProject(null, userId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("enqueueValidateAll", () => {
  it("inserts a parent row with recordingKind:'all' + summary.plannedChildren=N AND one child run per recording", async () => {
    const project = await createProject({
      solutionName: "ValAllSvc",
      namespace: "ValAllSvc.QA",
    });
    setCurrentProject(project, userId);

    // Seed three recordings owned by the caller. The unreachable
    // startUrl makes the background pump fail fast so we don't wait on
    // real chromium for cleanup.
    const recordings = [
      { filePath: "Tests/A.cs", methodName: "AOne" },
      { filePath: "Tests/B.cs", methodName: "BOne" },
      { filePath: "Tests/C.cs", methodName: "COne" },
    ];
    for (const r of recordings) {
      await saveActionSet({
        userId,
        projectName: project.solutionName,
        filePath: r.filePath,
        kind: "testMethod",
        methodName: r.methodName,
        urlName: "Local",
        startUrl: "http://127.0.0.1:1",
        actions: [],
      });
    }

    let parentId = "";
    try {
      parentId = await enqueueValidateAll({ userId, project });
      expect(typeof parentId).toBe("string");
      expect(parentId.length).toBeGreaterThan(0);

      // Parent row shape: kind:"all", parentRunId null, summary
      // carries the planned-children count and the child id list.
      const [parent] = await db
        .select()
        .from(validationRunsTable)
        .where(eq(validationRunsTable.id, parentId));
      expect(parent).toBeDefined();
      expect(parent!.recordingKind).toBe("all");
      expect(parent!.parentRunId).toBeNull();
      expect(parent!.recordingFilePath).toBeNull();
      expect(parent!.projectName).toBe(project.solutionName);
      expect(parent!.triggeredByUserId).toBe(userId);
      const summary = parent!.summary as {
        plannedChildren?: number;
        childIds?: string[];
      };
      expect(summary.plannedChildren).toBe(recordings.length);
      expect(Array.isArray(summary.childIds)).toBe(true);
      expect(summary.childIds!.length).toBe(recordings.length);

      // Each child row links back via parentRunId and carries the
      // recording's filePath / kind / methodName.
      const children = await db
        .select()
        .from(validationRunsTable)
        .where(eq(validationRunsTable.parentRunId, parentId));
      expect(children).toHaveLength(recordings.length);
      const filePaths = children.map((c) => c.recordingFilePath).sort();
      expect(filePaths).toEqual(recordings.map((r) => r.filePath).sort());
      for (const c of children) {
        expect(c.recordingKind).toBe("testMethod");
        expect(c.projectName).toBe(project.solutionName);
        expect(c.parentRunId).toBe(parentId);
      }
    } finally {
      // Wait briefly for the background pump to mark each child
      // errored on the unreachable URL, then drop everything so the
      // single-active-run guard doesn't bleed into the next test.
      await new Promise((r) => setTimeout(r, 1500));
      if (parentId) {
        await db
          .delete(validationRunsTable)
          .where(eq(validationRunsTable.parentRunId, parentId));
        await db
          .delete(validationRunsTable)
          .where(eq(validationRunsTable.id, parentId));
      }
    }
  });

  it("attachValidationSocket back-fills the buffered events for a newly-enqueued run (run-queued at minimum)", async () => {
    const project = await createProject({
      solutionName: "ValAllSocket",
      namespace: "ValAllSocket.QA",
    });
    setCurrentProject(project, userId);

    // Enqueue a single child run pointed at an unreachable URL so the
    // pump fails fast. We deliberately pass a parentRunId so the
    // single-active-run guard doesn't reject us.
    await saveActionSet({
      userId,
      projectName: project.solutionName,
      filePath: "Tests/Sock.cs",
      kind: "testMethod",
      methodName: "SockOne",
      urlName: "Local",
      startUrl: "http://127.0.0.1:1",
      actions: [],
    });

    const parentId = await enqueueValidateAll({ userId, project });
    try {
      // Find the only child of this parent and attach a fake WS to it
      // immediately — pushEvent has already buffered "run-queued"
      // synchronously inside enqueueValidationRun.
      const children = await db
        .select()
        .from(validationRunsTable)
        .where(eq(validationRunsTable.parentRunId, parentId));
      expect(children.length).toBeGreaterThan(0);
      const childId = children[0]!.id;

      const sent: unknown[] = [];
      let closed = false;
      let onClose: (() => void) | null = null;
      const fakeWs = {
        send: (data: string) => {
          sent.push(JSON.parse(data));
        },
        close: () => {
          closed = true;
          if (onClose) onClose();
        },
        on: (evt: string, cb: () => void) => {
          if (evt === "close") onClose = cb;
        },
      } as unknown as WebSocket;
      attachValidationSocket(fakeWs, childId);

      // The "run-queued" envelope is guaranteed to have been buffered
      // before enqueueValidationRun returned, so the back-fill loop
      // inside attachValidationSocket should have replayed it onto the
      // socket synchronously.
      expect(sent.length).toBeGreaterThan(0);
      const types = sent.map((e) => (e as { type?: string }).type);
      expect(types).toContain("run-queued");

      // Wait briefly for the background pump to fail-fast on the
      // unreachable URL; either we receive a run-finished envelope and
      // the socket gets closed, or we time out — we don't fail the
      // test on the latter because the pump's exact step shape is
      // covered elsewhere.
      const start = Date.now();
      while (Date.now() - start < 4_000 && !closed) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const finalTypes = sent.map((e) => (e as { type?: string }).type);
      // We should have observed at least one "run-started" or
      // "run-finished" envelope after the queued one — even fail-fast
      // runs emit at least the started/finished pair.
      expect(
        finalTypes.some(
          (t) =>
            t === "run-started" || t === "run-finished" || t === "run-cancelled",
        ),
      ).toBe(true);
    } finally {
      await new Promise((r) => setTimeout(r, 1500));
      await db
        .delete(validationRunsTable)
        .where(eq(validationRunsTable.parentRunId, parentId));
      await db
        .delete(validationRunsTable)
        .where(eq(validationRunsTable.id, parentId));
    }
  });

  it("rejects an enqueueValidationRun while another run for the same project is queued/running", async () => {
    const project = await createProject({
      solutionName: "ValAllGuard",
      namespace: "ValAllGuard.QA",
    });
    setCurrentProject(project, userId);

    // First run takes the lock — fail-fast URL so the pump tears it
    // down quickly. We don't await its completion; we just expect the
    // second concurrent enqueue to be rejected.
    const firstRunId = await enqueueValidationRun({
      userId,
      filePath: "Tests/Lock.cs",
      kind: "testMethod",
      methodName: "LockOne",
      project,
    });
    try {
      await expect(
        enqueueValidationRun({
          userId,
          filePath: "Tests/Lock.cs",
          kind: "testMethod",
          methodName: "LockTwo",
          project,
        }),
      ).rejects.toThrow();
    } finally {
      await new Promise((r) => setTimeout(r, 1500));
      await db
        .delete(validationRunsTable)
        .where(inArray(validationRunsTable.id, [firstRunId]));
    }
  });

  it("inserts a parent row with plannedChildren:0 and no child runs when the project has no recordings", async () => {
    const project = await createProject({
      solutionName: "ValAllEmpty",
      namespace: "ValAllEmpty.QA",
    });
    setCurrentProject(project, userId);

    let parentId = "";
    try {
      parentId = await enqueueValidateAll({ userId, project });
      const [parent] = await db
        .select()
        .from(validationRunsTable)
        .where(eq(validationRunsTable.id, parentId));
      expect(parent).toBeDefined();
      expect(parent!.recordingKind).toBe("all");
      const summary = parent!.summary as {
        plannedChildren?: number;
        childIds?: string[];
      };
      expect(summary.plannedChildren).toBe(0);
      expect(summary.childIds ?? []).toEqual([]);
      const children = await db
        .select()
        .from(validationRunsTable)
        .where(eq(validationRunsTable.parentRunId, parentId));
      expect(children).toHaveLength(0);
    } finally {
      await new Promise((r) => setTimeout(r, 200));
      if (parentId) {
        await db
          .delete(validationRunsTable)
          .where(eq(validationRunsTable.id, parentId));
      }
    }
  });
});

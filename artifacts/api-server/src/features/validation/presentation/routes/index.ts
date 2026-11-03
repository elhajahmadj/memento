import { Router, type IRouter, type Request } from "express";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  validationRunsTable,
  recordedActionSetsTable,
} from "@workspace/db";
import { requireAdminOrAssignedToCurrentProjectOrOwner } from "@/shared/middlewares/requireRole";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import {
  traceZipPathForRun,
  finalScreenshotPathForRun,
  ActiveValidationRunError,
  sanitizeForPath,
} from "@/features/validation/infrastructure/replayService";
import { getContainer } from "@/composition/container";
import { getStoppedSessionForUser } from "@/features/recording/infrastructure/recordingService";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";

const router: IRouter = Router();

type RunRow = typeof validationRunsTable.$inferSelect;

/** Resolve a run row that the requester is allowed to see, or null. */
async function loadAuthorizedRun(
  req: Request,
  id: string,
): Promise<RunRow | null> {
  if (!req.user?.id) return null;
  const project = getCurrentProject(req.user.id);
  if (!project) return null;
  const [row] = await db
    .select()
    .from(validationRunsTable)
    .where(eq(validationRunsTable.id, id))
    .limit(1);
  if (!row) return null;
  // Run must belong to the project the user currently has loaded.
  if (row.projectName !== project.solutionName) return null;
  // Admins/limited admins assigned to the project can see all of its runs;
  // everyone else can only see runs they themselves triggered.
  if (req.user.role === "admin" || req.user.role === "limited_admin") {
    return row;
  }
  if (row.triggeredByUserId !== req.user.id) return null;
  return row;
}

router.get(
  "/validation/recordings",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const project = getCurrentProject(req.user.id);
    if (!project) {
      res.status(400).json({ error: "No project loaded" });
      return;
    }
    // Recordings live inside the caller's per-user fork: multiple
    // users can have independent forks that share a solutionName, so
    // we must scope by (projectName, userId) to avoid leaking another
    // user's fork data. Admins see only their own fork too — they can
    // switch into a target user's context elsewhere in the app if they
    // need to inspect that user's recordings.
    const rows = await db
      .select()
      .from(recordedActionSetsTable)
      .where(
        and(
          eq(recordedActionSetsTable.projectName, project.solutionName),
          eq(recordedActionSetsTable.userId, req.user.id),
        ),
      )
      .orderBy(desc(recordedActionSetsTable.updatedAt));
    const persisted = rows.map((r) => ({
      source: "stored" as const,
      unsaved: false,
      filePath: r.filePath,
      kind: r.kind,
      methodName: r.methodName === "" ? null : r.methodName,
      urlName: r.urlName,
      startUrl: r.startUrl,
      updatedAt: r.updatedAt.toISOString(),
      ownerUserId: r.userId,
    }));
    // Surface the in-memory STOPPED session (if any) as a synthetic
    // "unsaved" entry pinned to the top so the user can validate it
    // before committing to Save. The session's actions live only in
    // process memory; the validate route reads them from there at run
    // time rather than persisting a draft here.
    const session = getStoppedSessionForUser(req.user.id);
    if (session && session.projectName === project.solutionName) {
      const synthetic = {
        source: "session" as const,
        unsaved: true,
        filePath: session.filePath,
        kind: session.kind,
        methodName: session.methodName,
        urlName: session.urlName,
        startUrl: session.startUrl,
        updatedAt: new Date().toISOString(),
        ownerUserId: session.userId,
      };
      res.json([synthetic, ...persisted]);
      return;
    }
    res.json(persisted);
  },
);

router.post(
  "/validation/runs",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const project = getCurrentProject(req.user.id);
    if (!project) {
      res.status(400).json({ error: "No project loaded" });
      return;
    }
    const body = (req.body ?? {}) as {
      all?: unknown;
      source?: unknown;
      filePath?: unknown;
      kind?: unknown;
      methodName?: unknown;
    };
    try {
      if (body.source === "session") {
        // Validate the in-memory STOPPED recording session belonging
        // to the caller. We bypass the recordedActionSetsTable lookup
        // because nothing has been persisted yet.
        const session = getStoppedSessionForUser(req.user.id);
        if (!session || session.projectName !== project.solutionName) {
          res
            .status(404)
            .json({ error: "No stopped recording session to validate" });
          return;
        }
        // Hook validation (beforeEach/oneTimeSetup) still requires a
        // saved recording — the in-memory unsaved path is intentionally
        // limited to test methods. Out of scope for task #200.
        if (session.kind !== "testMethod") {
          res.status(400).json({
            error:
              "Only test method recordings can be validated before saving — save the hook first.",
          });
          return;
        }
        const id = await getContainer().useCases.validation.enqueueValidationRun({
          userId: req.user.id,
          filePath: session.filePath,
          kind: session.kind,
          methodName: session.methodName,
          project,
          inlineActions: {
            actions: session.actions,
            urlName: session.urlName,
            startUrl: session.startUrl,
            sessionToken: session.sessionToken,
          },
        });
        await recordAudit({
          user: req.user,
          project: project.solutionName,
          action: "validation_queued",
          file: session.filePath,
          details: {
            runId: id,
            kind: session.kind,
            methodName: session.methodName,
            source: "session",
          },
        });
        res.status(201).json({ id });
        return;
      }
      if (body.all === true) {
        const id = await getContainer().useCases.validation.enqueueValidateAll({
          userId: req.user.id,
          project,
        });
        await recordAudit({
          user: req.user,
          project: project.solutionName,
          action: "validation_queued",
          details: { runId: id, scope: "all" },
        });
        res.status(201).json({ id });
        return;
      }
      const filePath = typeof body.filePath === "string" ? body.filePath : "";
      const kind = body.kind;
      if (!filePath) {
        res.status(400).json({ error: "filePath is required" });
        return;
      }
      if (
        kind !== "beforeEach" &&
        kind !== "oneTimeSetup" &&
        kind !== "testMethod"
      ) {
        res
          .status(400)
          .json({ error: "kind must be beforeEach, oneTimeSetup, or testMethod" });
        return;
      }
      const methodName =
        typeof body.methodName === "string" ? body.methodName : null;
      if (kind === "testMethod" && !methodName) {
        res
          .status(400)
          .json({ error: "methodName is required for testMethod" });
        return;
      }
      // Verify the recording exists in the caller's per-user fork.
      // Scoping by both projectName AND userId here prevents another
      // user with a same-named fork from being targeted.
      const [recording] = await db
        .select({ userId: recordedActionSetsTable.userId })
        .from(recordedActionSetsTable)
        .where(
          and(
            eq(recordedActionSetsTable.projectName, project.solutionName),
            eq(recordedActionSetsTable.userId, req.user.id),
            eq(recordedActionSetsTable.filePath, filePath),
            eq(recordedActionSetsTable.kind, kind),
            eq(recordedActionSetsTable.methodName, methodName ?? ""),
          ),
        )
        .limit(1);
      if (!recording) {
        res.status(404).json({ error: "Recording not found" });
        return;
      }
      const id = await getContainer().useCases.validation.enqueueValidationRun({
        userId: req.user.id,
        filePath,
        kind,
        methodName,
        project,
      });
      await recordAudit({
        user: req.user,
        project: project.solutionName,
        action: "validation_queued",
        file: filePath,
        details: { runId: id, kind, methodName },
      });
      res.status(201).json({ id });
    } catch (e) {
      if (e instanceof ActiveValidationRunError) {
        res
          .status(409)
          .json({ error: e.message, activeRunId: e.activeRunId });
        return;
      }
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.get(
  "/validation/runs/:id",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const row = await loadAuthorizedRun(req, id);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      id: row.id,
      projectName: row.projectName,
      parentRunId: row.parentRunId,
      recordingFilePath: row.recordingFilePath,
      recordingKind: row.recordingKind,
      recordingMethodName: row.recordingMethodName,
      status: row.status,
      queuedAt: row.queuedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      summary: row.summary,
      traceRef: row.traceRef,
      triggeredByUserId: row.triggeredByUserId,
    });
  },
);

router.get(
  "/validation/runs/:id/trace",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const row = await loadAuthorizedRun(req, id);
    if (!row || !row.traceRef) {
      res.status(404).json({ error: "No trace available for this run" });
      return;
    }
    const abs = traceZipPathForRun(row.traceRef);
    if (!abs || !fs.existsSync(abs)) {
      res.status(404).json({ error: "Trace file missing" });
      return;
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="validation-${id}.zip"`,
    );
    fs.createReadStream(abs).pipe(res);
  },
);

router.get(
  "/validation/runs/:id/visual-diff",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const row = await loadAuthorizedRun(req, id);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const requested = typeof req.query.path === "string" ? req.query.path : "";
    if (!requested) {
      res.status(400).json({ error: "path query param is required" });
      return;
    }
    // Scope the served path to THIS run's project subtree under
    // .validation-baselines/<sanitizeForPath(projectName)>/. A bare
    // .validation-baselines root would let any authorized run read diff
    // images belonging to a different project.
    const projectBaselinesRoot = path.resolve(
      process.cwd(),
      ".validation-baselines",
      sanitizeForPath(row.projectName),
    );
    const abs = path.resolve(requested);
    const rel = path.relative(projectBaselinesRoot, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      res
        .status(403)
        .json({ error: "Path is outside this project's baselines tree" });
      return;
    }
    if (!abs.endsWith(".png") || !fs.existsSync(abs)) {
      res.status(404).json({ error: "Visual diff image not found" });
      return;
    }
    res.setHeader("Content-Type", "image/png");
    fs.createReadStream(abs).pipe(res);
  },
);

router.get(
  "/validation/runs/:id/screenshot",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const row = await loadAuthorizedRun(req, id);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const abs = finalScreenshotPathForRun(id);
    if (!fs.existsSync(abs)) {
      res.status(404).json({ error: "No screenshot for this run" });
      return;
    }
    res.setHeader("Content-Type", "image/png");
    fs.createReadStream(abs).pipe(res);
  },
);

router.get(
  "/validation/runs",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const project = getCurrentProject(req.user.id);
    if (!project) {
      res.status(400).json({ error: "No project loaded" });
      return;
    }
    const isAdminish =
      req.user.role === "admin" || req.user.role === "limited_admin";
    const where = isAdminish
      ? eq(validationRunsTable.projectName, project.solutionName)
      : and(
          eq(validationRunsTable.projectName, project.solutionName),
          eq(validationRunsTable.triggeredByUserId, req.user.id),
        );
    const rows = await db
      .select()
      .from(validationRunsTable)
      .where(where)
      .orderBy(desc(validationRunsTable.queuedAt))
      .limit(50);
    res.json(
      rows.map((r) => ({
        id: r.id,
        projectName: r.projectName,
        parentRunId: r.parentRunId,
        recordingFilePath: r.recordingFilePath,
        recordingKind: r.recordingKind,
        recordingMethodName: r.recordingMethodName,
        status: r.status,
        queuedAt: r.queuedAt.toISOString(),
        startedAt: r.startedAt?.toISOString() ?? null,
        finishedAt: r.finishedAt?.toISOString() ?? null,
        summary: r.summary,
        traceRef: r.traceRef,
        triggeredByUserId: r.triggeredByUserId,
      })),
    );
  },
);

export default router;

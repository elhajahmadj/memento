import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, aiRunsTable } from "@workspace/db";
import { requireAdminOrAssigned } from "@/shared/middlewares/requireRole";
import { startAiRun } from "@/features/ai-agent/infrastructure/runner";
import { AiAgentDisabledError } from "@/features/ai-agent/domain/types";
import { assertResponseShape } from "@/shared/assertResponseShape";
import {
  GetAiAgentRunResponse,
  ListAiAgentRunsResponse,
} from "@workspace/api-zod";
import { getActiveOrgId, paramString } from "./_shared";
import { buildRunReport } from "./runReport";

const router: IRouter = Router();

router.post(
  "/ai-agent/projects/:projectName/runs",
  requireAdminOrAssigned((req) => paramString(req.params.projectName)),
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const orgId = await getActiveOrgId(req);
    const body = req.body as {
      kind?: "playwright" | "api" | "unit";
      suiteName?: string;
      methodName?: string | null;
      plan?: string;
      category?: string;
      language?: "csharp" | "python" | "nodejs" | "java";
      targetMode?: "new_suite" | "add_method";
      existingSuiteFile?: string | null;
      targetMethod?: "test" | "beforeEach" | "oneTimeSetUp";
      ignore?: boolean;
      ignoreReason?: string | null;
    };
    if (!body.kind || !body.suiteName || !body.plan || !body.language) {
      res
        .status(400)
        .json({ error: "kind, suiteName, plan, language are required" });
      return;
    }
    if (body.targetMode === "add_method") {
      const f = (body.existingSuiteFile ?? "").trim();
      if (!f) {
        res.status(400).json({
          error:
            "existingSuiteFile is required when targetMode is add_method",
        });
        return;
      }
      // Reject path-traversal attempts and absolute paths up front;
      // the materializer also passes the derived path through
      // safeJoin, but we want a clearer 400 here than a 500 later.
      if (
        f.includes("..") ||
        f.startsWith("/") ||
        /^[a-zA-Z]:[\\/]/.test(f)
      ) {
        res
          .status(400)
          .json({ error: "existingSuiteFile must be a project-relative path" });
        return;
      }
    }
    const targetMethod = body.targetMethod ?? "test";
    if (
      targetMethod !== "test" &&
      targetMethod !== "beforeEach" &&
      targetMethod !== "oneTimeSetUp"
    ) {
      res.status(400).json({
        error: "targetMethod must be one of test, beforeEach, oneTimeSetUp",
      });
      return;
    }
    const ignore = body.ignore === true;
    const ignoreReason = ignore ? (body.ignoreReason ?? "").trim() : null;
    if (ignore && !ignoreReason) {
      res
        .status(400)
        .json({ error: "ignoreReason is required when ignore is true" });
      return;
    }
    try {
      const run = await startAiRun({
        organizationId: orgId,
        projectName,
        kind: body.kind,
        suiteName: body.suiteName,
        methodName: body.methodName ?? null,
        planText: body.plan,
        category: body.category,
        language: body.language,
        targetMode: body.targetMode ?? "new_suite",
        existingSuiteFile: body.existingSuiteFile ?? null,
        targetMethod,
        ignore,
        ignoreReason,
        triggeredByUserId: req.user!.id,
      });
      res.status(202).json({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
      });
    } catch (e) {
      if (e instanceof AiAgentDisabledError) {
        res.status(409).json({ error: e.message, code: e.code });
        return;
      }
      const msg = (e as Error).message ?? "";
      // Runner rejects `ignore=true` combined with a setup hook target
      // synchronously (NUnit/pytest/etc. only honor skip annotations on
      // test methods). Surface a clean 400 instead of a generic 500.
      if (msg.startsWith("ignore=true cannot be combined")) {
        res.status(400).json({ error: msg });
        return;
      }
      res.status(500).json({ error: msg });
    }
  },
);

router.get(
  "/ai-agent/projects/:projectName/runs",
  requireAdminOrAssigned((req) => paramString(req.params.projectName)),
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const rows = await db
      .select()
      .from(aiRunsTable)
      .where(eq(aiRunsTable.projectName, projectName))
      .orderBy(desc(aiRunsTable.startedAt))
      .limit(50);
    const body = assertResponseShape(
      ListAiAgentRunsResponse,
      {
        runs: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          suiteName: r.suiteName,
          status: r.status,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
          errorMessage: r.errorMessage,
        })),
      },
      "GET /ai-agent/projects/:projectName/runs",
    );
    res.json(body);
  },
);

router.get(
  "/ai-agent/projects/:projectName/runs/:runId",
  requireAdminOrAssigned((req) => paramString(req.params.projectName)),
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const runId = paramString(req.params.runId);
    const rows = await db
      .select()
      .from(aiRunsTable)
      .where(
        and(
          eq(aiRunsTable.id, runId),
          eq(aiRunsTable.projectName, projectName),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    const report = await buildRunReport(row);
    const body = assertResponseShape(
      GetAiAgentRunResponse,
      {
        id: row.id,
        projectName: row.projectName,
        kind: row.kind,
        suiteName: row.suiteName,
        plan: row.planText,
        status: row.status,
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
        errorMessage: row.errorMessage,
        report,
        materializedFiles: row.materializedFiles,
      },
      "GET /ai-agent/projects/:projectName/runs/:runId",
    );
    res.json(body);
  },
);

export default router;

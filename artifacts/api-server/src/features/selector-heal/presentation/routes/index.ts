import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { healSelector } from "@/features/selector-heal/infrastructure/selectorHealService";
import { suggestSelectorFix } from "@/features/selector-heal/application/aiHealUseCase";
import {
  cancelRepickSession,
  pickAt,
  refreshScreenshot,
  startRepickSession,
} from "@/features/selector-heal/infrastructure/repickSession";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import { requireAdminOrAssignedToCurrentProjectOrOwner } from "@/shared/middlewares/requireRole";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import { getActiveOrgId } from "@/features/ai-agent/presentation/routes/_shared";
import { assertAgentReady } from "@/features/ai-agent/infrastructure/aiAgentService";
import { AiAgentDisabledError } from "@/features/ai-agent/domain/types";
import { httpStatusForAppError } from "@workspace/kernel";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

const HealBodySchema = z.object({
  oldSelector: z.string().min(1),
  newSelector: z.string().min(1),
  dryRun: z.boolean().optional(),
  // Which UI path proposed this heal — recorded on the audit row so an
  // admin reviewing the audit feed can see whether the fix came from
  // the AI, a re-pick session, or someone editing the selector text.
  via: z.enum(["ai", "repick", "advanced"]).optional(),
  // AI metadata — only populated when `via === "ai"`. Captured on
  // suggest, echoed back by the client on apply so the audit row
  // shows the same provider/model/tokens that produced the fix.
  aiProvider: z.string().nullish(),
  aiModel: z.string().nullish(),
  aiConfidence: z.enum(["high", "medium", "low"]).nullish(),
  aiTokensIn: z.number().int().nonnegative().nullish(),
  aiTokensOut: z.number().int().nonnegative().nullish(),
});

router.post(
  "/selectors/heal",
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
    const parsed = HealBodySchema.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    if (parsed.data.oldSelector === parsed.data.newSelector) {
      res.status(400).json({ error: "newSelector must differ from oldSelector" });
      return;
    }
    try {
      const isDryRun = parsed.data.dryRun === true;
      const result = await healSelector({
        userId: req.user.id,
        projectName: project.solutionName,
        oldSelector: parsed.data.oldSelector,
        newSelector: parsed.data.newSelector,
        dryRun: isDryRun,
        // Pass the loaded project so the heal also walks the on-disk
        // Selectors files (per-language scaffold layout) and rewrites
        // any literal string match. Required for the "across every
        // reference in the project" guarantee.
        project,
      });
      // Audit only on apply, not dry-run preview, so the audit log
      // reflects state changes only. Records both recording-row
      // replacements and on-disk Selectors-file rewrites for full
      // traceability of the heal.
      if (!isDryRun && result.totalReplacements + result.fileDetails.reduce((s, d) => s + d.replacements, 0) > 0) {
        const via = parsed.data.via ?? "advanced";
        await recordAudit({
          user: req.user,
          project: project.solutionName,
          action: "selector_heal",
          details: {
            via,
            oldSelector: parsed.data.oldSelector,
            newSelector: parsed.data.newSelector,
            recordingsChanged: result.recordingsChanged,
            recordingReplacements: result.totalReplacements,
            filesChanged: result.filesChanged,
            fileReplacements: result.fileDetails.reduce((s, d) => s + d.replacements, 0),
            // AI provenance is only meaningful when via === "ai".
            ...(via === "ai"
              ? {
                  aiProvider: parsed.data.aiProvider ?? null,
                  aiModel: parsed.data.aiModel ?? null,
                  aiConfidence: parsed.data.aiConfidence ?? null,
                  aiTokensIn: parsed.data.aiTokensIn ?? null,
                  aiTokensOut: parsed.data.aiTokensOut ?? null,
                }
              : {}),
          },
        });
        req.log.info(
          {
            event: "selector_heal_apply",
            via,
            oldSelector: parsed.data.oldSelector,
            newSelector: parsed.data.newSelector,
            recordingsChanged: result.recordingsChanged,
            filesChanged: result.filesChanged,
            ...(via === "ai"
              ? {
                  aiProvider: parsed.data.aiProvider ?? null,
                  aiModel: parsed.data.aiModel ?? null,
                  aiConfidence: parsed.data.aiConfidence ?? null,
                }
              : {}),
          },
          "Selector heal applied",
        );
      }
      res.json(result);
    } catch (e) {
      req.log.error({ err: e }, "Failed to heal selector");
      res.status(500).json({ error: (e as Error).message });
    }
  },
);

const AiSuggestBodySchema = z.object({
  oldSelector: z.string().min(1),
  actionDescription: z.string().nullish(),
  errorMessage: z.string().nullish(),
  pageUrl: z.string().nullish(),
  domSnippet: z.string().nullish(),
  priorSteps: z.array(z.string()).optional(),
});

router.post(
  "/selectors/heal/ai-suggest",
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
    const parsed = AiSuggestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const orgId = await getActiveOrgId(req);
    const result = await suggestSelectorFix({
      organizationId: orgId,
      projectName: project.solutionName,
      oldSelector: parsed.data.oldSelector,
      context: {
        actionDescription: parsed.data.actionDescription ?? null,
        errorMessage: parsed.data.errorMessage ?? null,
        pageUrl: parsed.data.pageUrl ?? null,
        domSnippet: parsed.data.domSnippet ?? null,
        priorSteps: parsed.data.priorSteps ?? [],
      },
    });
    if (result.kind === "err") {
      const status = httpStatusForAppError(result.error);
      res.status(status).json({
        error: result.error.message,
        kind: result.error.kind,
      });
      return;
    }
    const s = result.value;
    // Audit the suggestion attempt (not the apply — apply still goes
    // through /selectors/heal). Captures provider, model, token usage
    // so AI usage shows up in the existing audit feed.
    await recordAudit({
      user: req.user,
      project: project.solutionName,
      action: "ai_selector_heal_suggest",
      details: {
        oldSelector: parsed.data.oldSelector,
        suggestedSelector: s.suggestedSelector,
        confidence: s.confidence,
        provider: s.provider,
        model: s.model,
        tokensIn: s.tokensIn,
        tokensOut: s.tokensOut,
      },
    });
    res.json({
      suggestedSelector: s.suggestedSelector,
      confidence: s.confidence,
      explanation: s.explanation,
      model: s.model,
      provider: s.provider,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
    });
  },
);

/**
 * Lightweight "is AI usable right now?" probe used by the Fix-selector
 * dialog to disable the AI tab + show a tooltip explaining why,
 * BEFORE the user clicks. Returns `{ available: true }` when an org/
 * project AI key resolves cleanly, or `{ available: false, reason }`
 * with a non-coder-friendly message + a setup link the UI can render.
 * Never returns 5xx — the UI treats every non-200 the same.
 */
router.get(
  "/selectors/heal/ai-available",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const project = getCurrentProject(req.user.id);
    if (!project) {
      res.json({
        available: false,
        reason: "no_project",
        message: "Load a project before using AI selector healing.",
      });
      return;
    }
    try {
      const orgId = await getActiveOrgId(req);
      const creds = await assertAgentReady({
        organizationId: orgId,
        projectName: project.solutionName,
      });
      res.json({
        available: true,
        provider: creds.provider,
      });
    } catch (e) {
      if (e instanceof AiAgentDisabledError) {
        res.json({
          available: false,
          reason: e.code,
          message: e.message,
          setupHref: "/tools/ai-agent",
        });
        return;
      }
      res.json({
        available: false,
        reason: "unknown",
        message:
          "Couldn't check AI availability. The manual paths still work.",
      });
    }
  },
);

const RepickStartSchema = z.object({
  pageUrl: z.string().url(),
  viewport: z
    .object({
      width: z.number().int().min(320).max(3840),
      height: z.number().int().min(240).max(2160),
    })
    .optional(),
  /** Old selector — when supplied, the session highlights its previous
   *  match site after navigation so the user has a visual anchor before
   *  clicking the replacement. Best-effort, fail-soft. */
  oldSelector: z.string().min(1).max(2000).optional(),
});

router.post(
  "/selectors/heal/repick/start",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = RepickStartSchema.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    try {
      const ownerUserId = req.user.id;
      const result = await startRepickSession({
        pageUrl: parsed.data.pageUrl,
        ownerUserId,
        ...(parsed.data.viewport !== undefined
          ? { viewport: parsed.data.viewport }
          : {}),
        ...(parsed.data.oldSelector !== undefined
          ? { oldSelector: parsed.data.oldSelector }
          : {}),
      });
      res.json(result);
    } catch (e) {
      const msg = (e as Error).message;
      // SSRF guard rejections come back from the infra layer as a
      // plain Error — surface as 400 so the client shows the reason
      // instead of a generic "bad gateway".
      const status = /not allowed|Invalid URL|Only http/.test(msg) ? 400 : 502;
      req.log.warn({ err: e }, "Failed to start re-pick session");
      res.status(status).json({ error: msg });
    }
  },
);

const RepickPickSchema = z.object({
  sessionId: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
});

router.post(
  "/selectors/heal/repick/pick",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = RepickPickSchema.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    try {
      const result = await pickAt({
        sessionId: parsed.data.sessionId,
        x: parsed.data.x,
        y: parsed.data.y,
        ownerUserId: req.user.id,
      });
      if (!result) {
        res.status(404).json({
          error:
            "No element was found at that point — try clicking directly on the control.",
        });
        return;
      }
      res.json(result);
    } catch (e) {
      req.log.warn({ err: e }, "Re-pick pick failed");
      res.status(502).json({ error: (e as Error).message });
    }
  },
);

router.post(
  "/selectors/heal/repick/refresh",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = req.body as { sessionId?: unknown };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    const png = await refreshScreenshot({
      sessionId,
      ownerUserId: req.user.id,
    });
    if (!png) {
      res.status(404).json({ error: "Session not found or expired." });
      return;
    }
    res.json({ screenshotBase64: png });
  },
);

router.post(
  "/selectors/heal/repick/cancel",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = req.body as { sessionId?: unknown };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    const ok = await cancelRepickSession({
      sessionId,
      ownerUserId: req.user.id,
    });
    res.json({ closed: ok });
  },
);

export default router;

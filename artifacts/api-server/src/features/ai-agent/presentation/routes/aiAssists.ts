import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  runAiAssist,
  AiAssistError,
} from "@/features/ai-agent/infrastructure/aiAssistKit";
import { getAiAssistPurpose } from "@/features/ai-agent/infrastructure/aiAssistPurposes";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import { requireAdminOrAssignedToCurrentProjectOrOwner } from "@/shared/middlewares/requireRole";
import { assertResponseShape } from "@/shared/assertResponseShape";
import { getActiveOrgId, paramString } from "./_shared";

/**
 * Wrapper schema every assist response must conform to before it
 * leaves the server. Purpose-specific `output` shape is intentionally
 * left as `unknown` here — each purpose's own Zod schema already
 * validates the model's output inside `runAiAssist`. This guards the
 * outer envelope (which the shared `useAiAssist` client hook reads).
 */
const aiAssistResponseSchema = z.object({
  output: z.unknown(),
  model: z.string().nullable(),
  usage: z.object({
    promptTokens: z.number().nullable(),
    completionTokens: z.number().nullable(),
    totalTokens: z.number().nullable(),
  }),
  purpose: z.string(),
});

/**
 * Single dispatch endpoint for every AI assist surface in the app.
 *
 *   POST /api/ai-agent/assists/:purpose
 *   body: <purpose-specific input>
 *   response: { output, model, usage, purpose }
 *
 * Project + org are resolved server-side from the caller's session so
 * the UI doesn't need to thread them through (mirrors the
 * selector-heal route).
 */
const router: IRouter = Router();

router.post(
  "/ai-agent/assists/:purpose",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const project = getCurrentProject(req.user.id);
    if (!project) {
      res.status(400).json({
        error: "No project loaded. Open a project before using AI assists.",
      });
      return;
    }
    const purposeId = paramString(req.params.purpose);
    const purpose = getAiAssistPurpose(purposeId);
    if (!purpose) {
      res.status(404).json({ error: `Unknown AI assist: ${purposeId}` });
      return;
    }
    const parsed = purpose.input.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: `Invalid input: ${parsed.error.message}` });
      return;
    }
    const orgId = await getActiveOrgId(req);
    try {
      const result = await runAiAssist({
        purpose,
        input: parsed.data,
        organizationId: orgId,
        projectName: project.solutionName,
        userId: req.user.id,
      });
      const safe = assertResponseShape(
        aiAssistResponseSchema,
        result,
        `POST /api/ai-agent/assists/${purposeId}`,
      );
      res.json(safe);
    } catch (err) {
      if (err instanceof AiAssistError) {
        const payload: Record<string, unknown> = {
          error: err.message,
          code: err.code,
        };
        if (err.disabledReason) payload.disabledReason = err.disabledReason;
        if (err.providerStatus !== undefined) {
          payload.providerStatus = err.providerStatus;
        }
        res.status(err.httpStatus).json(payload);
        return;
      }
      req.log.error({ err, purposeId }, "AI assist failed unexpectedly");
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

export default router;

import { Router, type IRouter } from "express";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import { assertResponseShape } from "@/shared/assertResponseShape";
import {
  CheckAiAgentKeyResponse,
  SetDefaultAiAgentKeyResponse,
} from "@workspace/api-zod";
import {
  checkAiKeyHealth,
  setDefaultAiKey,
} from "@/features/ai-agent/infrastructure/aiKeyService";
import { getActiveOrgId, paramString } from "./_shared";
import { handleKeyError, viewKey } from "./_keyHelpers";

const router: IRouter = Router();

router.post("/ai-agent/keys/:id/default", requireAdmin, async (req, res) => {
  const orgId = await getActiveOrgId(req);
  const id = paramString(req.params.id);
  try {
    const updated = await setDefaultAiKey({
      id,
      organizationId: orgId,
      userId: req.user!.id,
    });
    const out = assertResponseShape(
      SetDefaultAiAgentKeyResponse,
      viewKey(updated),
      "POST /ai-agent/keys/:id/default",
    );
    res.json(out);
  } catch (e) {
    handleKeyError(res, e);
  }
});

router.post("/ai-agent/keys/:id/check", requireAdmin, async (req, res) => {
  const orgId = await getActiveOrgId(req);
  const id = paramString(req.params.id);
  try {
    const result = await checkAiKeyHealth({ id, organizationId: orgId });
    if (result.retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
    }
    // Per the requirement, `reason` is the structured failure code
    // (e.g. `unauthorized`, `rate_limited`, `network`, `other`).
    // It is omitted on success.
    let reason: string | null = null;
    if (!result.ok) {
      const msg = (result.errorMessage ?? "").toLowerCase();
      if (result.retryAfterSeconds !== undefined) reason = "rate_limited";
      else if (/\b401\b|unauthor|invalid api key|forbidden|\b403\b/.test(msg))
        reason = "unauthorized";
      else if (/\b404\b|not found|deployment/.test(msg))
        reason = "not_found";
      else if (/timeout|network|fetch failed|enotfound|econnref/.test(msg))
        reason = "network";
      else reason = "other";
    }
    const out = assertResponseShape(
      CheckAiAgentKeyResponse,
      {
        ok: result.ok,
        provider: result.provider,
        reason,
        message: result.errorMessage ?? null,
        retryAfterSeconds: result.retryAfterSeconds ?? null,
      },
      "POST /ai-agent/keys/:id/check",
    );
    res.json(out);
  } catch (e) {
    handleKeyError(res, e);
  }
});

export default router;

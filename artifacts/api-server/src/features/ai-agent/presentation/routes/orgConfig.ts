import { Router, type IRouter } from "express";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import {
  getOrgConfig,
  upsertOrgConfig,
} from "@/features/ai-agent/infrastructure/aiAgentService";
import { verifyKey } from "@/features/ai-agent/infrastructure/llmProviders";
import { type AiProvider } from "@/features/ai-agent/domain/types";
import { AI_PROVIDERS } from "@/features/ai-agent/infrastructure/providers";
import { assertResponseShape } from "@/shared/assertResponseShape";
import { GetAiAgentOrgConfigResponse } from "@workspace/api-zod";
import { getActiveOrgId } from "./_shared";

const router: IRouter = Router();

function viewBody(cfg: Awaited<ReturnType<typeof getOrgConfig>>) {
  return {
    organizationId: cfg.organizationId,
    enabled: cfg.enabled,
    provider: cfg.provider,
    apiKeyLastFour: null,
    apiKeySetAt: null,
    model: null,
    endpointUrl: null,
    apiVersion: null,
    refererUrl: null,
    appName: null,
    updatedAt: cfg.updatedAt.toISOString(),
  };
}

router.get("/ai-agent/org-config", requireAdmin, async (req, res) => {
  const orgId = await getActiveOrgId(req);
  const cfg = await getOrgConfig(orgId);
  const body = assertResponseShape(
    GetAiAgentOrgConfigResponse,
    viewBody(cfg),
    "GET /ai-agent/org-config",
  );
  res.json(body);
});

/**
 * Legacy per-key fields (`apiKey`, `model`, `endpointUrl`,
 * `apiVersion`, `refererUrl`, `appName`) no longer live on the org
 * config — they belong on `ai_agent_keys` (the AI Key library).
 * Sending any of them on this PUT returns HTTP 410 pointing the
 * caller at `/api/ai-agent/keys`.
 */
const LEGACY_PER_KEY_FIELDS = [
  "apiKey",
  "model",
  "endpointUrl",
  "apiVersion",
  "refererUrl",
  "appName",
] as const;

router.put("/ai-agent/org-config", requireAdmin, async (req, res) => {
  const orgId = await getActiveOrgId(req);
  const raw = (req.body ?? {}) as Record<string, unknown>;
  const offending = LEGACY_PER_KEY_FIELDS.filter((f) => f in raw);
  if (offending.length > 0) {
    res.status(410).json({
      error:
        `Fields [${offending.join(", ")}] are no longer accepted on ` +
        `/ai-agent/org-config. Manage provider keys through ` +
        `/ai-agent/keys (the AI Key library) instead.`,
    });
    return;
  }
  const body = raw as {
    enabled?: boolean;
    provider?: AiProvider | null;
  };
  if (body.provider !== undefined && body.provider !== null) {
    if (!AI_PROVIDERS.includes(body.provider)) {
      res.status(400).json({ error: `Unknown provider: ${body.provider}` });
      return;
    }
  }
  try {
    const updated = await upsertOrgConfig({
      organizationId: orgId,
      enabled: body.enabled,
      provider: body.provider,
      updatedByUserId: req.user!.id,
    });
    res.json(viewBody(updated));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/ai-agent/verify-key", requireAdmin, async (req, res) => {
  const body = req.body as {
    provider?: string;
    apiKey?: string;
    endpointUrl?: string | null;
    apiVersion?: string | null;
    model?: string | null;
  };
  // After task #42 verify-key never falls back to a saved key — the
  // org-config row no longer stores one. Callers that want to test a
  // saved key use `/ai-agent/keys/:id/check` against the keys library.
  if (!body.apiKey) {
    res
      .status(400)
      .json({ ok: false, message: "apiKey is required." });
    return;
  }
  if (!body.provider || !AI_PROVIDERS.includes(body.provider as AiProvider)) {
    res.status(400).json({ ok: false, message: "Unknown provider." });
    return;
  }
  const result = await verifyKey({
    provider: body.provider as AiProvider,
    apiKey: body.apiKey,
    extras: {
      endpointUrl: body.endpointUrl ?? null,
      apiVersion: body.apiVersion ?? null,
      model: body.model ?? null,
      refererUrl: null,
      appName: null,
    },
  });
  if (result.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
  }
  res.json({ ok: result.ok, message: result.errorMessage ?? null });
});

export default router;

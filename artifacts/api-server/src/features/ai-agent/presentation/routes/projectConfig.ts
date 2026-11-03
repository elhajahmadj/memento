import { Router, type IRouter } from "express";
import {
  requireAdmin,
  requireAdminOrAssigned,
} from "@/shared/middlewares/requireRole";
import {
  getOrgConfig,
  getProjectConfig,
  setProjectEnabled,
} from "@/features/ai-agent/infrastructure/aiAgentService";
import { getAiKey } from "@/features/ai-agent/infrastructure/aiKeyService";
import { resolveActiveKey } from "@/features/ai-agent/infrastructure/aiKeyResolver";
import { assertResponseShape } from "@/shared/assertResponseShape";
import { GetAiAgentProjectConfigResponse } from "@workspace/api-zod";
import { getActiveOrgId, paramString } from "./_shared";

const router: IRouter = Router();

router.get(
  "/ai-agent/projects/:projectName/config",
  requireAdmin,
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const cfg = await getProjectConfig(projectName);
    const body = assertResponseShape(
      GetAiAgentProjectConfigResponse,
      {
        projectName,
        enabled: cfg?.enabled ?? true,
        aiKeyId: cfg?.aiKeyId ?? null,
        updatedAt: cfg?.updatedAt?.toISOString() ?? null,
      },
      "GET /ai-agent/projects/:projectName/config",
    );
    res.json(body);
  },
);

router.put(
  "/ai-agent/projects/:projectName/config",
  requireAdmin,
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const body = req.body as {
      enabled?: boolean;
      aiKeyId?: string | null;
    };
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ error: "enabled (boolean) required" });
      return;
    }
    // Normalize: empty string means "clear the override". Guard the
    // type before touching `.trim()` so a malformed payload (number,
    // object, array) returns a clean 400 instead of crashing into a
    // 500 via TypeError.
    let aiKeyId: string | null | undefined;
    if (body.aiKeyId === undefined) {
      aiKeyId = undefined;
    } else if (body.aiKeyId === null) {
      aiKeyId = null;
    } else if (typeof body.aiKeyId !== "string") {
      res
        .status(400)
        .json({ error: "aiKeyId must be a UUID string, null, or omitted." });
      return;
    } else if (body.aiKeyId.trim() === "") {
      aiKeyId = null;
    } else {
      aiKeyId = body.aiKeyId.trim();
    }

    if (typeof aiKeyId === "string") {
      // Cheap UUID shape gate — without it an arbitrary string would
      // bubble up as a Postgres 500 instead of a clean 400.
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(aiKeyId)) {
        res.status(400).json({ error: "aiKeyId must be a UUID." });
        return;
      }
      // Validate the referenced AI key belongs to the caller's
      // active org before binding it to the project — without this
      // gate, an admin could pin a project to a key from another
      // org just by sending the UUID.
      const orgId = await getActiveOrgId(req);
      const owned = await getAiKey(aiKeyId, orgId);
      if (!owned) {
        res
          .status(400)
          .json({ error: "aiKeyId does not belong to your organization." });
        return;
      }
    }
    const updated = await setProjectEnabled(
      projectName,
      body.enabled,
      req.user!.id,
      aiKeyId,
    );
    res.json({
      projectName: updated.projectName,
      enabled: updated.enabled,
      aiKeyId: updated.aiKeyId ?? null,
      updatedAt: updated.updatedAt.toISOString(),
    });
  },
);

router.get(
  "/ai-agent/projects/:projectName/status",
  requireAdminOrAssigned((req) => paramString(req.params.projectName)),
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const orgId = await getActiveOrgId(req);
    const orgCfg = await getOrgConfig(orgId);
    const projCfg = await getProjectConfig(projectName);
    const projectEnabled = projCfg?.enabled ?? true;
    // Per task #42 the org-config row no longer stores a key — resolve
    // through the AI Key library (project override → org default).
    const resolved = await resolveActiveKey({
      organizationId: orgId,
      projectName,
    });
    const hasApiKey = resolved !== null;
    const ready = orgCfg.enabled && projectEnabled && hasApiKey;
    let reason: "ORG_DISABLED" | "PROJECT_DISABLED" | "NO_API_KEY" | null =
      null;
    if (!orgCfg.enabled) reason = "ORG_DISABLED";
    else if (!projectEnabled) reason = "PROJECT_DISABLED";
    else if (!hasApiKey) reason = "NO_API_KEY";
    res.json({
      ready,
      reason,
      orgEnabled: orgCfg.enabled,
      projectEnabled,
      hasApiKey,
      provider: resolved?.provider ?? orgCfg.provider,
    });
  },
);

export default router;

import { Router, type IRouter } from "express";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import { assertResponseShape } from "@/shared/assertResponseShape";
import {
  GetAiAgentKeyResponse,
  ListAiAgentKeysResponse,
  UpdateAiAgentKeyResponse,
} from "@workspace/api-zod";
import {
  listAiKeys,
  getAiKey,
  createAiKey,
  updateAiKey,
  deleteAiKey,
} from "@/features/ai-agent/infrastructure/aiKeyService";
import { getActiveOrgId, paramString } from "./_shared";
import {
  DeleteAiKeyConflictShape,
  handleKeyError,
  viewKey,
} from "./_keyHelpers";

const router: IRouter = Router();

router.get("/ai-agent/keys", requireAdmin, async (req, res) => {
  const orgId = await getActiveOrgId(req);
  const keys = await listAiKeys(orgId);
  const body = assertResponseShape(
    ListAiAgentKeysResponse,
    { keys: keys.map(viewKey) },
    "GET /ai-agent/keys",
  );
  res.json(body);
});

router.post("/ai-agent/keys", requireAdmin, async (req, res) => {
  const orgId = await getActiveOrgId(req);
  const body = req.body as {
    name?: string;
    provider?: string;
    apiKey?: string;
    model?: string | null;
    endpointUrl?: string | null;
    apiVersion?: string | null;
    refererUrl?: string | null;
    appName?: string | null;
    isDefault?: boolean;
  };
  if (!body.name || !body.provider || !body.apiKey) {
    res
      .status(400)
      .json({ error: "name, provider, and apiKey are required" });
    return;
  }
  try {
    const created = await createAiKey({
      organizationId: orgId,
      name: body.name,
      provider: body.provider,
      apiKey: body.apiKey,
      model: body.model ?? null,
      endpointUrl: body.endpointUrl ?? null,
      apiVersion: body.apiVersion ?? null,
      refererUrl: body.refererUrl ?? null,
      appName: body.appName ?? null,
      isDefault: body.isDefault === true,
      userId: req.user!.id,
    });
    const out = assertResponseShape(
      GetAiAgentKeyResponse,
      viewKey(created),
      "POST /ai-agent/keys",
    );
    res.status(201).json(out);
  } catch (e) {
    handleKeyError(res, e);
  }
});

router.get("/ai-agent/keys/:id", requireAdmin, async (req, res) => {
  const orgId = await getActiveOrgId(req);
  const id = paramString(req.params.id);
  const key = await getAiKey(id, orgId);
  if (!key) {
    res.status(404).json({ error: "AI key not found" });
    return;
  }
  const out = assertResponseShape(
    GetAiAgentKeyResponse,
    viewKey(key),
    "GET /ai-agent/keys/:id",
  );
  res.json(out);
});

router.put("/ai-agent/keys/:id", requireAdmin, async (req, res) => {
  const orgId = await getActiveOrgId(req);
  const id = paramString(req.params.id);
  const body = req.body as {
    name?: string;
    provider?: string;
    apiKey?: string | null;
    model?: string | null;
    endpointUrl?: string | null;
    apiVersion?: string | null;
    refererUrl?: string | null;
    appName?: string | null;
    isDefault?: boolean;
  };
  try {
    const updated = await updateAiKey({
      id,
      organizationId: orgId,
      name: body.name,
      provider: body.provider,
      apiKey: body.apiKey,
      model: body.model,
      endpointUrl: body.endpointUrl,
      apiVersion: body.apiVersion,
      refererUrl: body.refererUrl,
      appName: body.appName,
      isDefault: body.isDefault,
      userId: req.user!.id,
    });
    const out = assertResponseShape(
      UpdateAiAgentKeyResponse,
      viewKey(updated),
      "PUT /ai-agent/keys/:id",
    );
    res.json(out);
  } catch (e) {
    handleKeyError(res, e);
  }
});

router.delete("/ai-agent/keys/:id", requireAdmin, async (req, res) => {
  const orgId = await getActiveOrgId(req);
  const id = paramString(req.params.id);
  try {
    const result = await deleteAiKey({ id, organizationId: orgId });
    if (result.deleted) {
      res.status(204).end();
      return;
    }
    if (result.reason === "bound_projects") {
      const body = assertResponseShape(
        DeleteAiKeyConflictShape,
        {
          error: "AI key is bound to one or more projects",
          boundProjects: result.boundProjects,
        },
        "DELETE /ai-agent/keys/:id (bound_projects)",
      );
      res.status(409).json(body);
      return;
    }
    const body = assertResponseShape(
      DeleteAiKeyConflictShape,
      {
        error:
          "Cannot delete the default key while other keys exist. Promote another key to default first.",
      },
      "DELETE /ai-agent/keys/:id (default_with_siblings)",
    );
    res.status(409).json(body);
  } catch (e) {
    handleKeyError(res, e);
  }
});

export default router;

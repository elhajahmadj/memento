import { Router, type IRouter } from "express";
import { db, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  deleteConfig,
  listAdministrableOrgIdsForCaller,
  listConfigsForOrgs,
  upsertConfig,
} from "@/features/nexus-config/infrastructure/nexusOrgConfigService";
import { PutNexusOrgConfigBody } from "@workspace/api-zod";
import { getEffectiveRole } from "@/shared/middlewares/effectiveRole";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

/**
 * `GET /api/nexus-config`
 *
 * Returns the per-org Nexus partner-key status for every organization
 * the caller can administer. Memento Admins see every org; per-org
 * admins see only their own orgs. The plaintext key is never returned
 * — only `apiKeyLastFour`. Orgs with no row come back with
 * `hasKey: false` so the UI can offer "Set key".
 */
router.get("/nexus-config", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const role = (await getEffectiveRole(req)) ?? req.user.role;
  const orgIds = await listAdministrableOrgIdsForCaller(req.user.id, role);
  if (orgIds.length === 0) {
    res.json([]);
    return;
  }
  const views = await listConfigsForOrgs(orgIds);
  res.json(views);
});

/**
 * `PUT /api/nexus-config/:orgId`
 *
 * Set or rotate the Nexus partner API key for one organization. The
 * caller must be `memento_admin` OR hold `admin` on the matching
 * `user_organizations` row. The key is encrypted at rest with
 * `PROJECT_SECRETS_KEY` and never read back by any other endpoint.
 */
router.put("/nexus-config/:orgId", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const role = (await getEffectiveRole(req)) ?? req.user.role;
  const orgIds = await listAdministrableOrgIdsForCaller(req.user.id, role);
  const { orgId } = req.params;
  if (!orgId || !orgIds.includes(orgId)) {
    // 403 (not 404) so a malicious caller can't probe which org ids
    // exist by toggling between configured/unconfigured.
    res.status(403).json({
      error: "You are not an admin of this organization.",
    });
    return;
  }
  const [org] = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId))
    .limit(1);
  if (!org) {
    res.status(404).json({ error: "Organization does not exist." });
    return;
  }
  const parsed = PutNexusOrgConfigBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    const view = await upsertConfig({
      organizationId: orgId,
      apiKey: parsed.data.apiKey,
      updatedByUserId: req.user.id,
    });
    res.json(view);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.warn({ err: msg }, "Failed to upsert IdP org config");
    res.status(500).json({ error: msg });
  }
});

/**
 * `DELETE /api/nexus-config/:orgId`
 *
 * Clear the per-org Nexus partner key. After this the IDP provisioner
 * falls back to the deployment-wide `NEXUS_API_KEY` env var when the
 * same org's admins next try to provision a user.
 */
router.delete("/nexus-config/:orgId", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const role = (await getEffectiveRole(req)) ?? req.user.role;
  const orgIds = await listAdministrableOrgIdsForCaller(req.user.id, role);
  const { orgId } = req.params;
  if (!orgId || !orgIds.includes(orgId)) {
    res.status(403).json({
      error: "You are not an admin of this organization.",
    });
    return;
  }
  const removed = await deleteConfig(orgId);
  if (!removed) {
    res
      .status(404)
      .json({ error: "No IdP key is configured for this organization." });
    return;
  }
  res.status(204).end();
});

export default router;

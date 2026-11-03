import {
  db,
  aiAgentKeysTable,
  aiAgentOrgConfigsTable,
} from "@workspace/db";
import { decryptSecret } from "@/shared/crypto";
import { logger } from "@/shared/logger";
import { isAiProvider, whereOrg } from "./aiKeyShared";

/**
 * Copy any legacy single-key row from `ai_agent_org_configs` into
 * `ai_agent_keys` as the org default. Idempotent — only seeds an
 * org that has a configured key but no rows in `ai_agent_keys` yet.
 * Called at boot.
 */
export async function backfillLegacyOrgKeysOnBoot(): Promise<void> {
  let legacy: Array<{
    id: string;
    organizationId: string | null;
    provider: string | null;
    apiKeyEncrypted: string | null;
    apiKeyLastFour: string | null;
    model: string | null;
    endpointUrl: string | null;
    apiVersion: string | null;
    refererUrl: string | null;
    appName: string | null;
    updatedByUserId: string;
  }>;
  try {
    legacy = await db
      .select({
        id: aiAgentOrgConfigsTable.id,
        organizationId: aiAgentOrgConfigsTable.organizationId,
        provider: aiAgentOrgConfigsTable.provider,
        apiKeyEncrypted: aiAgentOrgConfigsTable.apiKeyEncrypted,
        apiKeyLastFour: aiAgentOrgConfigsTable.apiKeyLastFour,
        model: aiAgentOrgConfigsTable.model,
        endpointUrl: aiAgentOrgConfigsTable.endpointUrl,
        apiVersion: aiAgentOrgConfigsTable.apiVersion,
        refererUrl: aiAgentOrgConfigsTable.refererUrl,
        appName: aiAgentOrgConfigsTable.appName,
        updatedByUserId: aiAgentOrgConfigsTable.updatedByUserId,
      })
      .from(aiAgentOrgConfigsTable);
  } catch {
    // Tables may not exist yet (pre-`db push`). Nothing to backfill.
    return;
  }

  for (const row of legacy) {
    if (!row.apiKeyEncrypted || !row.provider) continue;
    if (!isAiProvider(row.provider)) continue;
    // Skip if any key already exists for this org (we don't want
    // to step on an admin's curated library).
    const has = (
      await db
        .select({ id: aiAgentKeysTable.id })
        .from(aiAgentKeysTable)
        .where(whereOrg(row.organizationId))
        .limit(1)
    )[0];
    if (has) continue;

    try {
      // Sanity check the ciphertext is readable with the current key;
      // if not, skip rather than crash boot — the admin can rotate.
      decryptSecret(row.apiKeyEncrypted);
    } catch (err) {
      logger.warn(
        { err, orgId: row.organizationId },
        "Skipping AI key backfill — legacy ciphertext is not decryptable with the current PROJECT_SECRETS_KEY",
      );
      continue;
    }
    try {
      await db.insert(aiAgentKeysTable).values({
        organizationId: row.organizationId,
        name: "Default",
        provider: row.provider,
        apiKeyEncrypted: row.apiKeyEncrypted,
        apiKeyLastFour: row.apiKeyLastFour ?? "????",
        model: row.model,
        endpointUrl: row.endpointUrl,
        apiVersion: row.apiVersion,
        refererUrl: row.refererUrl,
        appName: row.appName,
        isDefault: true,
        createdByUserId: row.updatedByUserId,
        updatedByUserId: row.updatedByUserId,
      });
      logger.info(
        { orgId: row.organizationId },
        "Backfilled legacy AI org-config key into ai_agent_keys",
      );
    } catch (err) {
      logger.warn(
        { err, orgId: row.organizationId },
        "Failed to backfill legacy AI key (may already exist)",
      );
    }
  }
}

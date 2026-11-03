import { and, eq } from "drizzle-orm";
import {
  db,
  aiAgentKeysTable,
  aiAgentProjectConfigsTable,
  type AiAgentKey,
} from "@workspace/db";
import { decryptSecret } from "@/shared/crypto";
import type { ResolvedAiKey } from "./aiKeyTypes";
import { isAiProvider, whereOrg } from "./aiKeyShared";

function rowToResolved(
  row: AiAgentKey,
  source: ResolvedAiKey["source"],
): ResolvedAiKey {
  return {
    keyId: row.id,
    source,
    provider: isAiProvider(row.provider) ? row.provider : "anthropic",
    apiKey: decryptSecret(row.apiKeyEncrypted),
    extras: {
      endpointUrl: row.endpointUrl,
      apiVersion: row.apiVersion,
      refererUrl: row.refererUrl,
      appName: row.appName,
      model: row.model,
    },
  };
}

/**
 * Resolve the active AI key for a project: project override first,
 * then org default. Returns null when no key is available.
 */
export async function resolveActiveKey(opts: {
  organizationId: string | null;
  projectName: string;
}): Promise<ResolvedAiKey | null> {
  // 1. Project override — must belong to the caller's active org.
  // Pinning a project to a key outside its org would violate the
  // library's org isolation, so the resolver only honors overrides
  // that match `whereOrg(orgId)`.
  const projCfg = (
    await db
      .select()
      .from(aiAgentProjectConfigsTable)
      .where(eq(aiAgentProjectConfigsTable.projectName, opts.projectName))
      .limit(1)
  )[0];
  if (projCfg?.aiKeyId) {
    const row = (
      await db
        .select()
        .from(aiAgentKeysTable)
        .where(
          and(
            eq(aiAgentKeysTable.id, projCfg.aiKeyId),
            whereOrg(opts.organizationId),
          ),
        )
        .limit(1)
    )[0];
    if (row) {
      return rowToResolved(row, "project_override");
    }
  }
  // 2. Org default.
  const def = (
    await db
      .select()
      .from(aiAgentKeysTable)
      .where(
        and(
          whereOrg(opts.organizationId),
          eq(aiAgentKeysTable.isDefault, true),
        ),
      )
      .limit(1)
  )[0];
  if (def) return rowToResolved(def, "org_default");
  return null;
}

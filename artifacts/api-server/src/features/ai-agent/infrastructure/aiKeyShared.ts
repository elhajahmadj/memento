import { eq, isNull } from "drizzle-orm";
import { aiAgentKeysTable, type AiAgentKey } from "@workspace/db";
import type { PublicAiKey } from "./aiKeyTypes";
import { isAiProvider } from "./providers";

export { isAiProvider };

export function toPublic(row: AiAgentKey): PublicAiKey {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    provider: isAiProvider(row.provider) ? row.provider : "anthropic",
    apiKeyLastFour: row.apiKeyLastFour,
    model: row.model,
    endpointUrl: row.endpointUrl,
    apiVersion: row.apiVersion,
    refererUrl: row.refererUrl,
    appName: row.appName,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function whereOrg(orgId: string | null) {
  return orgId === null
    ? isNull(aiAgentKeysTable.organizationId)
    : eq(aiAgentKeysTable.organizationId, orgId);
}

export function trimOrNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

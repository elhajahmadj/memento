import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  aiAgentOrgConfigsTable,
  aiAgentProjectConfigsTable,
  aiCatalogMethodsTable,
  aiCatalogSelectorsTable,
  aiCatalogCategoriesTable,
  type AiAgentOrgConfig,
  type AiAgentProjectConfig,
} from "@workspace/db";
import {
  AiAgentDisabledError,
  type AiProvider,
} from "@/features/ai-agent/domain/types";
import { isAiProvider } from "./providers";

/**
 * View of the org config that is safe to return through the API. As
 * of task #42 the per-key fields (`apiKeyLastFour`, `apiKeySetAt`,
 * `model`, `endpointUrl`, `apiVersion`, `refererUrl`, `appName`) live
 * on `ai_agent_keys` and are always `null` on this view — clients
 * must read them from the keys library.
 */
export interface AiAgentOrgConfigView {
  organizationId: string | null;
  enabled: boolean;
  provider: AiProvider | null;
  apiKeyLastFour: null;
  apiKeySetAt: null;
  model: null;
  endpointUrl: null;
  apiVersion: null;
  refererUrl: null;
  appName: null;
  updatedAt: Date;
}

function viewOrgConfig(
  row: AiAgentOrgConfig | undefined,
  organizationId: string | null,
): AiAgentOrgConfigView {
  if (!row) {
    return {
      organizationId,
      enabled: false,
      provider: null,
      apiKeyLastFour: null,
      apiKeySetAt: null,
      model: null,
      endpointUrl: null,
      apiVersion: null,
      refererUrl: null,
      appName: null,
      updatedAt: new Date(0),
    };
  }
  return {
    organizationId: row.organizationId,
    enabled: row.enabled,
    provider: (row.provider as AiProvider | null) ?? null,
    apiKeyLastFour: null,
    apiKeySetAt: null,
    model: null,
    endpointUrl: null,
    apiVersion: null,
    refererUrl: null,
    appName: null,
    updatedAt: row.updatedAt,
  };
}

async function findOrgConfigRow(
  organizationId: string | null,
): Promise<AiAgentOrgConfig | undefined> {
  const where =
    organizationId === null
      ? isNull(aiAgentOrgConfigsTable.organizationId)
      : eq(aiAgentOrgConfigsTable.organizationId, organizationId);
  const rows = await db
    .select()
    .from(aiAgentOrgConfigsTable)
    .where(where)
    .limit(1);
  return rows[0];
}

export async function getOrgConfig(
  organizationId: string | null,
): Promise<AiAgentOrgConfigView> {
  const row = await findOrgConfigRow(organizationId);
  return viewOrgConfig(row, organizationId);
}

/**
 * Input for `upsertOrgConfig`. After task #42 the org-config table
 * only stores the org-wide `enabled` flag and the default `provider`.
 * Per-key fields (apiKey, model, endpointUrl, apiVersion, refererUrl,
 * appName) belong on `ai_agent_keys` and are accepted/rejected by the
 * keys library routes only.
 */
export interface UpsertOrgConfigInput {
  organizationId: string | null;
  enabled?: boolean | undefined;
  provider?: AiProvider | null | undefined;
  updatedByUserId: string;
}

export class AiProviderConfigError extends Error {}

export async function upsertOrgConfig(
  input: UpsertOrgConfigInput,
): Promise<AiAgentOrgConfigView> {
  if (input.provider !== undefined && input.provider !== null) {
    if (!isAiProvider(input.provider)) {
      throw new AiProviderConfigError(`Unknown provider: ${input.provider}`);
    }
  }

  const existing = await findOrgConfigRow(input.organizationId);
  const now = new Date();

  if (!existing) {
    const [row] = await db
      .insert(aiAgentOrgConfigsTable)
      .values({
        organizationId: input.organizationId,
        enabled: input.enabled ?? false,
        provider: input.provider ?? null,
        updatedByUserId: input.updatedByUserId,
      })
      .returning();
    return viewOrgConfig(row, input.organizationId);
  }

  const patch: Partial<typeof aiAgentOrgConfigsTable.$inferInsert> = {
    updatedByUserId: input.updatedByUserId,
    updatedAt: now,
  };
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.provider !== undefined) patch.provider = input.provider;

  const [row] = await db
    .update(aiAgentOrgConfigsTable)
    .set(patch)
    .where(eq(aiAgentOrgConfigsTable.id, existing.id))
    .returning();
  return viewOrgConfig(row, input.organizationId);
}

export async function getProjectConfig(
  projectName: string,
): Promise<AiAgentProjectConfig | null> {
  const rows = await db
    .select()
    .from(aiAgentProjectConfigsTable)
    .where(eq(aiAgentProjectConfigsTable.projectName, projectName))
    .limit(1);
  return rows[0] ?? null;
}

export async function setProjectEnabled(
  projectName: string,
  enabled: boolean,
  updatedByUserId: string,
  /**
   * Per-project AI-key override.
   * - `undefined`: leave the current value untouched.
   * - `null`: clear the override (fall back to the org default).
   * - `string`: pin this project to a specific `ai_agent_keys` row.
   */
  aiKeyId?: string | null,
): Promise<AiAgentProjectConfig> {
  const existing = await getProjectConfig(projectName);
  const now = new Date();
  if (!existing) {
    const [row] = await db
      .insert(aiAgentProjectConfigsTable)
      .values({
        projectName,
        enabled,
        aiKeyId: aiKeyId ?? null,
        updatedByUserId,
      })
      .returning();
    return row!;
  }
  const patch: Partial<typeof aiAgentProjectConfigsTable.$inferInsert> = {
    enabled,
    updatedByUserId,
    updatedAt: now,
  };
  if (aiKeyId !== undefined) patch.aiKeyId = aiKeyId;
  const [row] = await db
    .update(aiAgentProjectConfigsTable)
    .set(patch)
    .where(eq(aiAgentProjectConfigsTable.id, existing.id))
    .returning();
  return row!;
}

export interface DecryptedProviderCreds {
  provider: AiProvider;
  apiKey: string;
  extras: import("@/features/ai-agent/domain/types").AiProviderExtras;
}

/**
 * Authoritative gate. Throws an `AiAgentDisabledError` with the right
 * code if any of the three preconditions fails. On success returns the
 * decrypted provider+key+extras plus the project flag.
 *
 * Key resolution: project's `aiKeyId` override → org default
 * (`ai_agent_keys.isDefault`). The legacy single-key columns on
 * `ai_agent_org_configs` are migrated into the new table at boot;
 * once that backfill has run the resolver never reads them.
 */
export async function assertAgentReady(opts: {
  organizationId: string | null;
  projectName: string;
}): Promise<DecryptedProviderCreds> {
  const org = await findOrgConfigRow(opts.organizationId);
  if (!org || !org.enabled) {
    throw new AiAgentDisabledError("ORG_DISABLED");
  }
  const project = await getProjectConfig(opts.projectName);
  if (project && project.enabled === false) {
    throw new AiAgentDisabledError("PROJECT_DISABLED");
  }
  const { resolveActiveKey } = await import("./aiKeyService");
  const resolved = await resolveActiveKey({
    organizationId: opts.organizationId,
    projectName: opts.projectName,
  });
  if (!resolved) {
    throw new AiAgentDisabledError("NO_API_KEY");
  }
  return {
    provider: resolved.provider,
    apiKey: resolved.apiKey,
    extras: resolved.extras,
  };
}

// ---------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------

export async function listCatalogMethods(projectName: string) {
  return db
    .select()
    .from(aiCatalogMethodsTable)
    .where(eq(aiCatalogMethodsTable.projectName, projectName));
}

export async function listCatalogSelectors(projectName: string) {
  return db
    .select()
    .from(aiCatalogSelectorsTable)
    .where(eq(aiCatalogSelectorsTable.projectName, projectName));
}

export async function listCatalogCategories(projectName: string) {
  return db
    .select()
    .from(aiCatalogCategoriesTable)
    .where(eq(aiCatalogCategoriesTable.projectName, projectName));
}

export async function upsertCatalogMethod(opts: {
  projectName: string;
  name: string;
  params?: string[] | undefined;
  source: "user" | "ai";
  confidence?: number | undefined;
  createdInRunId?: string | undefined;
}) {
  const existing = await db
    .select()
    .from(aiCatalogMethodsTable)
    .where(
      and(
        eq(aiCatalogMethodsTable.projectName, opts.projectName),
        eq(aiCatalogMethodsTable.name, opts.name),
      ),
    )
    .limit(1);
  if (existing[0]) return { row: existing[0], created: false as const };
  const [row] = await db
    .insert(aiCatalogMethodsTable)
    .values({
      projectName: opts.projectName,
      name: opts.name,
      params: opts.params ?? null,
      source: opts.source,
      confidence: opts.confidence ?? null,
      createdInRunId: opts.createdInRunId ?? null,
    })
    .returning();
  return { row: row!, created: true as const };
}

export async function upsertCatalogSelector(opts: {
  projectName: string;
  name: string;
  selector: string;
  source: "user" | "ai";
  confidence?: number;
  createdInRunId?: string;
}) {
  const existing = await db
    .select()
    .from(aiCatalogSelectorsTable)
    .where(
      and(
        eq(aiCatalogSelectorsTable.projectName, opts.projectName),
        eq(aiCatalogSelectorsTable.name, opts.name),
      ),
    )
    .limit(1);
  if (existing[0]) return { row: existing[0], created: false as const };
  const [row] = await db
    .insert(aiCatalogSelectorsTable)
    .values({
      projectName: opts.projectName,
      name: opts.name,
      selector: opts.selector,
      source: opts.source,
      confidence: opts.confidence ?? null,
      createdInRunId: opts.createdInRunId ?? null,
    })
    .returning();
  return { row: row!, created: true as const };
}

export async function upsertCatalogCategory(opts: {
  projectName: string;
  name: string;
  source: "user" | "ai";
  createdInRunId?: string;
}) {
  const existing = await db
    .select()
    .from(aiCatalogCategoriesTable)
    .where(
      and(
        eq(aiCatalogCategoriesTable.projectName, opts.projectName),
        eq(aiCatalogCategoriesTable.name, opts.name),
      ),
    )
    .limit(1);
  if (existing[0]) return { row: existing[0], created: false as const };
  const [row] = await db
    .insert(aiCatalogCategoriesTable)
    .values({
      projectName: opts.projectName,
      name: opts.name,
      source: opts.source,
      createdInRunId: opts.createdInRunId ?? null,
    })
    .returning();
  return { row: row!, created: true as const };
}

export async function deleteCatalogMethod(id: string, projectName: string) {
  await db
    .delete(aiCatalogMethodsTable)
    .where(
      and(
        eq(aiCatalogMethodsTable.id, id),
        eq(aiCatalogMethodsTable.projectName, projectName),
      ),
    );
}

export async function deleteCatalogSelector(id: string, projectName: string) {
  await db
    .delete(aiCatalogSelectorsTable)
    .where(
      and(
        eq(aiCatalogSelectorsTable.id, id),
        eq(aiCatalogSelectorsTable.projectName, projectName),
      ),
    );
}

export async function deleteCatalogCategory(id: string, projectName: string) {
  await db
    .delete(aiCatalogCategoriesTable)
    .where(
      and(
        eq(aiCatalogCategoriesTable.id, id),
        eq(aiCatalogCategoriesTable.projectName, projectName),
      ),
    );
}

export async function renameCatalogMethod(
  id: string,
  projectName: string,
  newName: string,
) {
  const [row] = await db
    .update(aiCatalogMethodsTable)
    .set({ name: newName, updatedAt: new Date() })
    .where(
      and(
        eq(aiCatalogMethodsTable.id, id),
        eq(aiCatalogMethodsTable.projectName, projectName),
      ),
    )
    .returning();
  return row ?? null;
}

export async function renameCatalogSelector(
  id: string,
  projectName: string,
  newName: string,
) {
  const [row] = await db
    .update(aiCatalogSelectorsTable)
    .set({ name: newName, updatedAt: new Date() })
    .where(
      and(
        eq(aiCatalogSelectorsTable.id, id),
        eq(aiCatalogSelectorsTable.projectName, projectName),
      ),
    )
    .returning();
  return row ?? null;
}

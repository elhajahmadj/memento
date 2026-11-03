import { and, eq, ne } from "drizzle-orm";
import { db, aiAgentKeysTable } from "@workspace/db";
import { encryptSecret, getProjectSecretsKey } from "@/shared/crypto";
import {
  AiKeyServiceError,
  type CreateAiKeyInput,
  type PublicAiKey,
  type UpdateAiKeyInput,
} from "./aiKeyTypes";
import { isAiProvider, toPublic, trimOrNull, whereOrg } from "./aiKeyShared";
import {
  validateAzureRequirements,
  validateExtrasForProvider,
} from "./aiKeyValidation";
import { getProviderDefinition } from "./providers";

export async function listAiKeys(orgId: string | null): Promise<PublicAiKey[]> {
  const rows = await db
    .select()
    .from(aiAgentKeysTable)
    .where(whereOrg(orgId))
    .orderBy(aiAgentKeysTable.name);
  return rows.map(toPublic);
}

export async function getAiKey(
  id: string,
  orgId: string | null,
): Promise<PublicAiKey | null> {
  const row = (
    await db
      .select()
      .from(aiAgentKeysTable)
      .where(and(eq(aiAgentKeysTable.id, id), whereOrg(orgId)))
      .limit(1)
  )[0];
  return row ? toPublic(row) : null;
}

export async function createAiKey(
  input: CreateAiKeyInput,
): Promise<PublicAiKey> {
  if (!isAiProvider(input.provider)) {
    throw new AiKeyServiceError(
      400,
      `Unknown provider: ${String(input.provider)}`,
    );
  }
  const name = input.name.trim();
  if (!name) throw new AiKeyServiceError(400, "Name is required");
  const apiKey = input.apiKey.trim();
  if (apiKey.length < 8) {
    throw new AiKeyServiceError(400, "API key looks too short to be valid.");
  }
  // Prove the encryption key works before writing.
  getProjectSecretsKey();

  const model = trimOrNull(input.model);
  const endpointUrl = trimOrNull(input.endpointUrl);
  let apiVersion = trimOrNull(input.apiVersion);
  const refererUrl = trimOrNull(input.refererUrl);
  const appName = trimOrNull(input.appName);

  validateExtrasForProvider(input.provider, {
    model,
    endpointUrl,
    apiVersion,
    refererUrl,
    appName,
  });
  if (input.provider === "azure_openai") {
    validateAzureRequirements({ endpointUrl, model });
  }
  const createDef = getProviderDefinition(input.provider);
  if (!apiVersion && createDef.defaultApiVersion) {
    apiVersion = createDef.defaultApiVersion;
  }

  const dupe = (
    await db
      .select({ id: aiAgentKeysTable.id })
      .from(aiAgentKeysTable)
      .where(and(whereOrg(input.organizationId), eq(aiAgentKeysTable.name, name)))
      .limit(1)
  )[0];
  if (dupe) {
    throw new AiKeyServiceError(
      400,
      `An AI key named "${name}" already exists for this organization.`,
    );
  }

  // If this is the very first key for the org, default to making it
  // the org default so the resolver can pick it up immediately.
  const existingCount = (
    await db
      .select({ id: aiAgentKeysTable.id })
      .from(aiAgentKeysTable)
      .where(whereOrg(input.organizationId))
      .limit(1)
  )[0];
  const isDefault = input.isDefault === true || !existingCount;

  return db.transaction(async (tx) => {
    if (isDefault) {
      await tx
        .update(aiAgentKeysTable)
        .set({ isDefault: false })
        .where(
          and(
            whereOrg(input.organizationId),
            eq(aiAgentKeysTable.isDefault, true),
          ),
        );
    }
    const [row] = await tx
      .insert(aiAgentKeysTable)
      .values({
        organizationId: input.organizationId,
        name,
        provider: input.provider,
        apiKeyEncrypted: encryptSecret(apiKey),
        apiKeyLastFour: apiKey.slice(-4),
        model,
        endpointUrl,
        apiVersion,
        refererUrl,
        appName,
        isDefault,
        createdByUserId: input.userId,
        updatedByUserId: input.userId,
      })
      .returning();
    return toPublic(row!);
  });
}

export async function updateAiKey(
  input: UpdateAiKeyInput,
): Promise<PublicAiKey> {
  const existing = (
    await db
      .select()
      .from(aiAgentKeysTable)
      .where(
        and(
          eq(aiAgentKeysTable.id, input.id),
          whereOrg(input.organizationId),
        ),
      )
      .limit(1)
  )[0];
  if (!existing) {
    throw new AiKeyServiceError(404, "AI key not found");
  }

  const provider = input.provider ?? existing.provider;
  if (!isAiProvider(provider)) {
    throw new AiKeyServiceError(400, `Unknown provider: ${String(provider)}`);
  }
  const name = input.name !== undefined ? input.name.trim() : existing.name;
  if (!name) throw new AiKeyServiceError(400, "Name is required");

  const model =
    input.model !== undefined ? trimOrNull(input.model) : existing.model;
  const endpointUrl =
    input.endpointUrl !== undefined
      ? trimOrNull(input.endpointUrl)
      : existing.endpointUrl;
  let apiVersion =
    input.apiVersion !== undefined
      ? trimOrNull(input.apiVersion)
      : existing.apiVersion;
  const refererUrl =
    input.refererUrl !== undefined
      ? trimOrNull(input.refererUrl)
      : existing.refererUrl;
  const appName =
    input.appName !== undefined ? trimOrNull(input.appName) : existing.appName;

  validateExtrasForProvider(provider, {
    model,
    endpointUrl,
    apiVersion,
    refererUrl,
    appName,
  });
  if (provider === "azure_openai") {
    validateAzureRequirements({ endpointUrl, model });
  }
  const updateDef = getProviderDefinition(provider);
  if (!apiVersion && updateDef.defaultApiVersion) {
    apiVersion = updateDef.defaultApiVersion;
  }

  // Duplicate-name guard (within the same org, excluding self).
  if (name !== existing.name) {
    const dupe = (
      await db
        .select({ id: aiAgentKeysTable.id })
        .from(aiAgentKeysTable)
        .where(
          and(
            whereOrg(input.organizationId),
            eq(aiAgentKeysTable.name, name),
            ne(aiAgentKeysTable.id, input.id),
          ),
        )
        .limit(1)
    )[0];
    if (dupe) {
      throw new AiKeyServiceError(
        400,
        `An AI key named "${name}" already exists for this organization.`,
      );
    }
  }

  let apiKeyEncrypted: string | undefined;
  let apiKeyLastFour: string | undefined;
  if (typeof input.apiKey === "string") {
    const trimmed = input.apiKey.trim();
    if (trimmed.length < 8) {
      throw new AiKeyServiceError(400, "API key looks too short to be valid.");
    }
    getProjectSecretsKey();
    apiKeyEncrypted = encryptSecret(trimmed);
    apiKeyLastFour = trimmed.slice(-4);
  }

  return db.transaction(async (tx) => {
    if (input.isDefault === true && !existing.isDefault) {
      await tx
        .update(aiAgentKeysTable)
        .set({ isDefault: false })
        .where(
          and(
            whereOrg(input.organizationId),
            eq(aiAgentKeysTable.isDefault, true),
          ),
        );
    }
    if (input.isDefault === false && existing.isDefault) {
      // The org-default invariant says exactly one row per org must
      // carry `isDefault = true`. Clearing it directly here would
      // leave the org with keys but no default — `resolveActiveKey`
      // would then return null and silently break agent runs. The
      // only safe way to switch defaults is `setDefaultAiKey`, which
      // atomically promotes a sibling. So we always reject this path,
      // including the sole-key case (which has no valid replacement).
      throw new AiKeyServiceError(
        400,
        "Cannot unset the default key. Promote another key to default first via POST /ai-agent/keys/:id/default.",
      );
    }
    const patch: Partial<typeof aiAgentKeysTable.$inferInsert> = {
      name,
      provider,
      model,
      endpointUrl,
      apiVersion,
      refererUrl,
      appName,
      updatedByUserId: input.userId,
      updatedAt: new Date(),
    };
    if (apiKeyEncrypted !== undefined) patch.apiKeyEncrypted = apiKeyEncrypted;
    if (apiKeyLastFour !== undefined) patch.apiKeyLastFour = apiKeyLastFour;
    if (input.isDefault !== undefined) patch.isDefault = input.isDefault;
    const [row] = await tx
      .update(aiAgentKeysTable)
      .set(patch)
      .where(eq(aiAgentKeysTable.id, input.id))
      .returning();
    return toPublic(row!);
  });
}

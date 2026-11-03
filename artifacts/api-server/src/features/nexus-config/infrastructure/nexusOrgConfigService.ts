import {
  db,
  nexusOrgConfigsTable,
  organizationsTable,
  userOrganizationsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  decryptSecret,
  encryptSecret,
  getProjectSecretsKey,
} from "@/shared/crypto";
import { logger } from "@/shared/logger";

export interface NexusOrgConfigView {
  organizationId: string;
  organizationName: string;
  hasKey: boolean;
  apiKeyLastFour: string | null;
  updatedAt: string | null;
  updatedByUsername: string | null;
}

/**
 * Per-org Nexus partner-API-key store. The plaintext key is **only**
 * ever returned by {@link resolveApiKeyForOrg} (used by the IDP
 * provisioner adapter); every other read returns the redacted
 * {@link NexusOrgConfigView} shape so the SPA never gets the secret.
 *
 * Encryption matches `ai_agent_org_configs` / `project_git_configs` —
 * AES-256-GCM with the key derived from `PROJECT_SECRETS_KEY`.
 */
export async function listConfigsForOrgs(
  orgIds: string[],
): Promise<NexusOrgConfigView[]> {
  if (orgIds.length === 0) return [];
  const orgs = await db
    .select({
      id: organizationsTable.id,
      displayName: organizationsTable.displayName,
    })
    .from(organizationsTable)
    .where(inArray(organizationsTable.id, orgIds));
  const configs = await db
    .select({
      organizationId: nexusOrgConfigsTable.organizationId,
      apiKeyLastFour: nexusOrgConfigsTable.apiKeyLastFour,
      updatedAt: nexusOrgConfigsTable.updatedAt,
      updatedByUsername: usersTable.username,
    })
    .from(nexusOrgConfigsTable)
    .leftJoin(
      usersTable,
      eq(nexusOrgConfigsTable.updatedByUserId, usersTable.id),
    )
    .where(inArray(nexusOrgConfigsTable.organizationId, orgIds));
  const byOrgId = new Map<string, (typeof configs)[number]>(
    configs.map((c) => [c.organizationId, c]),
  );
  return orgs.map((o: (typeof orgs)[number]) => {
    const c = byOrgId.get(o.id);
    return {
      organizationId: o.id,
      organizationName: o.displayName,
      hasKey: !!c,
      apiKeyLastFour: c?.apiKeyLastFour ?? null,
      updatedAt: c?.updatedAt?.toISOString() ?? null,
      updatedByUsername: c?.updatedByUsername ?? null,
    };
  });
}

export async function upsertConfig(input: {
  organizationId: string;
  apiKey: string;
  updatedByUserId: string;
}): Promise<NexusOrgConfigView> {
  const trimmed = input.apiKey.trim();
  if (!trimmed) {
    throw new Error("API key is required");
  }
  // Fail fast if the symmetric key isn't configured — without it we
  // can't encrypt the value at rest.
  getProjectSecretsKey();
  const ciphertext = encryptSecret(trimmed);
  const lastFour = trimmed.slice(-4);
  await db
    .insert(nexusOrgConfigsTable)
    .values({
      organizationId: input.organizationId,
      apiKeyEncrypted: ciphertext,
      apiKeyLastFour: lastFour,
      updatedByUserId: input.updatedByUserId,
    })
    .onConflictDoUpdate({
      target: nexusOrgConfigsTable.organizationId,
      set: {
        apiKeyEncrypted: ciphertext,
        apiKeyLastFour: lastFour,
        updatedByUserId: input.updatedByUserId,
        updatedAt: new Date(),
      },
    });
  const [view] = await listConfigsForOrgs([input.organizationId]);
  return view!;
}

export async function deleteConfig(organizationId: string): Promise<boolean> {
  const result = await db
    .delete(nexusOrgConfigsTable)
    .where(eq(nexusOrgConfigsTable.organizationId, organizationId))
    .returning({ id: nexusOrgConfigsTable.id });
  return result.length > 0;
}

/**
 * Resolve the Nexus partner API key for one memento org. Returns the
 * per-org key when configured, the deployment-wide `NEXUS_API_KEY`
 * env var as a fallback, or `null` when neither is set. The fallback
 * keeps single-tenant deployments (and orgs that haven't configured
 * a key yet) working transparently.
 *
 * The `mementoOrgId` argument is the memento `organizations.id`
 * (UUID) — not Nexus's own org id. Pass `null` for system-level
 * operations that aren't scoped to an org (the env-var fallback is
 * used in that case).
 */
export async function resolveApiKeyForOrg(
  mementoOrgId: string | null,
): Promise<string | null> {
  if (mementoOrgId) {
    try {
      const [row] = await db
        .select({ apiKeyEncrypted: nexusOrgConfigsTable.apiKeyEncrypted })
        .from(nexusOrgConfigsTable)
        .where(eq(nexusOrgConfigsTable.organizationId, mementoOrgId))
        .limit(1);
      if (row) {
        return decryptSecret(row.apiKeyEncrypted);
      }
    } catch (err) {
      // If decryption fails the row exists but the symmetric key has
      // rotated or the ciphertext is corrupt. Log and fall through to
      // the env-var fallback so the deployment is at least partially
      // usable instead of every IDP call hard-failing.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), mementoOrgId },
        "Failed to decrypt per-org IdP key; falling back to env var",
      );
    }
  }
  const envKey = process.env.NEXUS_API_KEY?.trim();
  return envKey && envKey.length > 0 ? envKey : null;
}

/**
 * Org-admin guard for the Settings → Identity page. Returns the set
 * of memento `organizations.id` the caller may see/mutate Nexus keys
 * for. Memento Admins see every org; per-org admins see only the
 * orgs where their `user_organizations.role` is `admin`. Limited
 * admins and regular users get an empty array.
 */
export async function listAdministrableOrgIdsForCaller(
  userId: string,
  effectiveRole: string,
): Promise<string[]> {
  if (effectiveRole === "memento_admin") {
    const all = await db
      .select({ id: organizationsTable.id })
      .from(organizationsTable);
    return all.map((o: { id: string }) => o.id);
  }
  const rows = await db
    .select({ organizationId: userOrganizationsTable.organizationId })
    .from(userOrganizationsTable)
    .where(
      and(
        eq(userOrganizationsTable.userId, userId),
        eq(userOrganizationsTable.role, "admin"),
      ),
    );
  return rows.map((r: { organizationId: string }) => r.organizationId);
}

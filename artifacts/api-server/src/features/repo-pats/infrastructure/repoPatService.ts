import { and, eq, ne } from "drizzle-orm";
import { db, repoPatsTable, type RepoPat } from "@workspace/db";
import {
  encryptSecret,
  decryptSecret,
  getProjectSecretsKey,
} from "@/shared/crypto";
import { logger } from "@/shared/logger";

export type RepoPatProvider = "azure_repos" | "github";

const SUPPORTED_PROVIDERS: readonly RepoPatProvider[] = [
  "azure_repos",
  "github",
];

function isRepoPatProvider(v: unknown): v is RepoPatProvider {
  return (
    typeof v === "string" &&
    (SUPPORTED_PROVIDERS as readonly string[]).includes(v)
  );
}

export interface PublicRepoPat {
  id: string;
  provider: RepoPatProvider;
  name: string;
  patLastFour: string;
  createdAt: string;
  updatedAt: string;
}

function toPublic(row: RepoPat): PublicRepoPat {
  return {
    id: row.id,
    provider: isRepoPatProvider(row.provider) ? row.provider : "azure_repos",
    name: row.name,
    patLastFour: row.patLastFour,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listRepoPats(): Promise<PublicRepoPat[]> {
  const rows = await db
    .select()
    .from(repoPatsTable)
    .orderBy(repoPatsTable.provider, repoPatsTable.name);
  return rows.map(toPublic);
}

export async function getRepoPat(id: string): Promise<PublicRepoPat | null> {
  const row = (
    await db
      .select()
      .from(repoPatsTable)
      .where(eq(repoPatsTable.id, id))
      .limit(1)
  )[0];
  return row ? toPublic(row) : null;
}

function normalizeName(raw: string): string {
  return raw.trim();
}

function validatePat(pat: string): string {
  const trimmed = pat.trim();
  if (trimmed.length < 8) {
    throw new Error("Personal Access Token looks too short");
  }
  return trimmed;
}

export async function createRepoPat(input: {
  provider: string;
  name: string;
  pat: string;
  userId: string;
}): Promise<PublicRepoPat> {
  if (!isRepoPatProvider(input.provider)) {
    throw new Error(
      `Unsupported git provider "${String(input.provider)}". Expected one of: ${SUPPORTED_PROVIDERS.join(", ")}`,
    );
  }
  const name = normalizeName(input.name);
  if (!name) throw new Error("Name is required");
  const pat = validatePat(input.pat);
  // Prove the encryption key works before writing.
  getProjectSecretsKey();
  const existing = (
    await db
      .select({ id: repoPatsTable.id })
      .from(repoPatsTable)
      .where(
        and(
          eq(repoPatsTable.provider, input.provider),
          eq(repoPatsTable.name, name),
        ),
      )
      .limit(1)
  )[0];
  if (existing) {
    throw new Error(
      `A Repo PAT named "${name}" already exists for this provider`,
    );
  }
  const [row] = await db
    .insert(repoPatsTable)
    .values({
      provider: input.provider,
      name,
      patEncrypted: encryptSecret(pat),
      patLastFour: pat.slice(-4),
      createdByUserId: input.userId,
      updatedByUserId: input.userId,
    })
    .returning();
  return toPublic(row!);
}

export async function updateRepoPat(input: {
  id: string;
  provider: string;
  name: string;
  pat: string | null;
  userId: string;
}): Promise<PublicRepoPat> {
  if (!isRepoPatProvider(input.provider)) {
    throw new Error(
      `Unsupported git provider "${String(input.provider)}". Expected one of: ${SUPPORTED_PROVIDERS.join(", ")}`,
    );
  }
  const name = normalizeName(input.name);
  if (!name) throw new Error("Name is required");
  const existing = (
    await db
      .select()
      .from(repoPatsTable)
      .where(eq(repoPatsTable.id, input.id))
      .limit(1)
  )[0];
  if (!existing) throw new Error("Repo PAT not found");

  const dupe = (
    await db
      .select({ id: repoPatsTable.id })
      .from(repoPatsTable)
      .where(
        and(
          eq(repoPatsTable.provider, input.provider),
          eq(repoPatsTable.name, name),
          ne(repoPatsTable.id, input.id),
        ),
      )
      .limit(1)
  )[0];
  if (dupe) {
    throw new Error(
      `A Repo PAT named "${name}" already exists for this provider`,
    );
  }

  const patch: Partial<typeof repoPatsTable.$inferInsert> = {
    provider: input.provider,
    name,
    updatedByUserId: input.userId,
    updatedAt: new Date(),
  };
  if (input.pat !== null) {
    const pat = validatePat(input.pat);
    getProjectSecretsKey();
    patch.patEncrypted = encryptSecret(pat);
    patch.patLastFour = pat.slice(-4);
  }
  await db.update(repoPatsTable).set(patch).where(eq(repoPatsTable.id, input.id));
  const row = (
    await db
      .select()
      .from(repoPatsTable)
      .where(eq(repoPatsTable.id, input.id))
      .limit(1)
  )[0];
  return toPublic(row!);
}

/**
 * Returns the project names whose git config currently references the
 * given Repo PAT. The delete guard blocks removal of any PAT that has
 * one or more bound projects.
 */
export async function findBoundProjectsForRepoPat(
  patId: string,
): Promise<string[]> {
  const { findProjectsBoundToRepoPat } = await import(
    "@/features/projects/infrastructure/gitConfigService"
  );
  return findProjectsBoundToRepoPat(patId);
}

export async function deleteRepoPat(id: string): Promise<{
  deleted: boolean;
  boundProjects: string[];
}> {
  const bound = await findBoundProjectsForRepoPat(id);
  if (bound.length > 0) {
    return { deleted: false, boundProjects: bound };
  }
  await db.delete(repoPatsTable).where(eq(repoPatsTable.id, id));
  return { deleted: true, boundProjects: [] };
}

/**
 * Verify at boot that we can decrypt at least one stored Repo PAT.
 * If the table has rows but `PROJECT_SECRETS_KEY` is missing or
 * wrong, fail fast with a clear error rather than waiting for the
 * next admin action to surface the problem.
 */
export async function assertRepoPatsEncryptionKeyOnBoot(): Promise<void> {
  let rows: RepoPat[];
  try {
    rows = await db.select().from(repoPatsTable).limit(1);
  } catch {
    // Table might not exist yet (pre-`db push`). Nothing to verify.
    return;
  }
  if (rows.length === 0) return;
  try {
    decryptSecret(rows[0]!.patEncrypted);
  } catch (err) {
    logger.error(
      { err },
      "PROJECT_SECRETS_KEY is missing or wrong; cannot decrypt stored Repo PATs",
    );
    throw err;
  }
}


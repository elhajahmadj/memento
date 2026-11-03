import { and, eq } from "drizzle-orm";
import {
  db,
  userProjectForksTable,
  type UserProjectFork,
} from "@workspace/db";
import {
  encryptSecret,
  decryptSecret,
  getProjectSecretsKey,
} from "@/shared/crypto";
import { logger } from "@/shared/logger";
import { validateRepoUrl } from "@/features/projects/infrastructure/git/gitProviderRegistry";
import type { GitProvider } from "@/features/projects/infrastructure/git/gitProvider";

const SUPPORTED_PROVIDERS: readonly GitProvider[] = ["azure_repos", "github"];

function isGitProvider(v: unknown): v is GitProvider {
  return (
    typeof v === "string" &&
    (SUPPORTED_PROVIDERS as readonly string[]).includes(v)
  );
}

function normalizeProvider(v: string | null | undefined): GitProvider {
  return isGitProvider(v) ? v : "azure_repos";
}

export interface PublicUserProjectFork {
  configured: boolean;
  provider: GitProvider | null;
  repoUrl: string | null;
  patSetAt: string | null;
  patLastFour: string | null;
}

const EMPTY_PUBLIC: PublicUserProjectFork = {
  configured: false,
  provider: null,
  repoUrl: null,
  patSetAt: null,
  patLastFour: null,
};

function toPublic(row: UserProjectFork | undefined): PublicUserProjectFork {
  if (!row) return { ...EMPTY_PUBLIC };
  return {
    configured: true,
    provider: normalizeProvider(row.provider),
    repoUrl: row.repoUrl,
    patSetAt: row.patSetAt.toISOString(),
    patLastFour: row.patLastFour,
  };
}

async function findRow(
  userId: string,
  projectName: string,
): Promise<UserProjectFork | undefined> {
  const rows = await db
    .select()
    .from(userProjectForksTable)
    .where(
      and(
        eq(userProjectForksTable.userId, userId),
        eq(userProjectForksTable.projectName, projectName),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function getMyFork(
  userId: string,
  projectName: string,
): Promise<PublicUserProjectFork> {
  return toPublic(await findRow(userId, projectName));
}

export interface UpsertForkInput {
  userId: string;
  projectName: string;
  provider: GitProvider;
  repoUrl: string;
  /** New PAT to store, or null to keep the existing one. */
  pat: string | null;
}

export async function upsertMyFork(
  input: UpsertForkInput,
): Promise<PublicUserProjectFork> {
  if (!isGitProvider(input.provider)) {
    throw new Error(
      `Unsupported git provider "${String(input.provider)}". Expected one of: ${SUPPORTED_PROVIDERS.join(", ")}`,
    );
  }
  const provider = input.provider;
  const repoUrl = validateRepoUrl(provider, input.repoUrl);

  const existing = await findRow(input.userId, input.projectName);

  if (input.pat === null) {
    if (!existing) {
      throw new Error("Personal Access Token is required");
    }
    await db
      .update(userProjectForksTable)
      .set({
        provider,
        repoUrl,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userProjectForksTable.userId, input.userId),
          eq(userProjectForksTable.projectName, input.projectName),
        ),
      );
  } else {
    const pat = input.pat.trim();
    if (pat.length < 8) {
      throw new Error("Personal Access Token looks too short");
    }
    // Prove the encryption key is configured *before* writing.
    getProjectSecretsKey();
    const patEncrypted = encryptSecret(pat);
    const patLastFour = pat.slice(-4);
    if (existing) {
      await db
        .update(userProjectForksTable)
        .set({
          provider,
          repoUrl,
          patEncrypted,
          patLastFour,
          patSetAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userProjectForksTable.userId, input.userId),
            eq(userProjectForksTable.projectName, input.projectName),
          ),
        );
    } else {
      await db.insert(userProjectForksTable).values({
        userId: input.userId,
        projectName: input.projectName,
        provider,
        repoUrl,
        patEncrypted,
        patLastFour,
      });
    }
  }
  return getMyFork(input.userId, input.projectName);
}

export async function deleteMyFork(
  userId: string,
  projectName: string,
): Promise<void> {
  await db
    .delete(userProjectForksTable)
    .where(
      and(
        eq(userProjectForksTable.userId, userId),
        eq(userProjectForksTable.projectName, projectName),
      ),
    );
}

/**
 * Internal-only: return the decrypted push target (provider, repoUrl,
 * pat) for a user/project pair, or null when none configured. Used by
 * `pushProject` to route pushes through a user's personal fork.
 */
export async function loadMyForkForPush(
  userId: string,
  projectName: string,
): Promise<{
  provider: GitProvider;
  repoUrl: string;
  pat: string;
} | null> {
  const row = await findRow(userId, projectName);
  if (!row) return null;
  const pat = decryptSecret(row.patEncrypted);
  return {
    provider: normalizeProvider(row.provider),
    repoUrl: row.repoUrl,
    pat,
  };
}

/**
 * Verify at boot that we can decrypt at least one stored personal-fork
 * PAT. If the table has rows but `PROJECT_SECRETS_KEY` is missing or
 * wrong, fail fast.
 */
export async function assertUserProjectForksEncryptionKeyOnBoot(): Promise<void> {
  let rows: UserProjectFork[];
  try {
    rows = await db.select().from(userProjectForksTable).limit(1);
  } catch {
    return;
  }
  if (rows.length === 0) return;
  try {
    decryptSecret(rows[0]!.patEncrypted);
  } catch (err) {
    logger.error(
      { err },
      "PROJECT_SECRETS_KEY is missing or wrong; cannot decrypt stored personal-fork PATs",
    );
    throw err;
  }
}

import { eq, isNotNull } from "drizzle-orm";
import {
  db,
  projectGitConfigsTable,
  repoPatsTable,
  type ProjectGitConfig,
  type RepoPat,
} from "@workspace/db";
import { decryptSecret } from "@/shared/crypto";
import { logger } from "@/shared/logger";
import {
  normalizeProvider,
  type GitProvider,
} from "@/features/projects/infrastructure/git/gitProvider";

export interface PublicGitConfig {
  provider: GitProvider;
  repoUrl: string;
  branch: string;
  patSetAt: string | null;
  patLastFour: string | null;
  repoPatId: string | null;
  repoPatName: string | null;
}

const EMPTY_PUBLIC: PublicGitConfig = {
  provider: "azure_repos",
  repoUrl: "",
  branch: "main",
  patSetAt: null,
  patLastFour: null,
  repoPatId: null,
  repoPatName: null,
};

export function toPublic(
  row: ProjectGitConfig | undefined,
  linkedPat: RepoPat | null,
): PublicGitConfig {
  if (!row) return { ...EMPTY_PUBLIC };
  if (row.repoPatId && linkedPat) {
    return {
      provider: normalizeProvider(linkedPat.provider),
      repoUrl: row.repoUrl,
      branch: row.branch,
      patSetAt: null,
      patLastFour: linkedPat.patLastFour,
      repoPatId: row.repoPatId,
      repoPatName: linkedPat.name,
    };
  }
  return {
    provider: normalizeProvider(row.provider),
    repoUrl: row.repoUrl,
    branch: row.branch,
    patSetAt: row.patSetAt ? row.patSetAt.toISOString() : null,
    patLastFour: row.patLastFour,
    repoPatId: null,
    repoPatName: null,
  };
}

export async function loadLinkedPat(
  repoPatId: string | null,
): Promise<RepoPat | null> {
  if (!repoPatId) return null;
  const row = (
    await db
      .select()
      .from(repoPatsTable)
      .where(eq(repoPatsTable.id, repoPatId))
      .limit(1)
  )[0];
  return row ?? null;
}

export async function loadGitConfigRow(
  projectName: string,
): Promise<ProjectGitConfig | undefined> {
  return (
    await db
      .select()
      .from(projectGitConfigsTable)
      .where(eq(projectGitConfigsTable.projectName, projectName))
      .limit(1)
  )[0];
}

export async function getGitConfig(
  projectName: string,
): Promise<PublicGitConfig> {
  const row = await loadGitConfigRow(projectName);
  const linked = await loadLinkedPat(row?.repoPatId ?? null);
  return toPublic(row, linked);
}

/**
 * Return the project names whose git config references the given
 * `repo_pats.id`. Used by the Repo PATs delete guard to block
 * removal of a PAT that's still in use.
 */
export async function findProjectsBoundToRepoPat(
  repoPatId: string,
): Promise<string[]> {
  const rows = await db
    .select({ projectName: projectGitConfigsTable.projectName })
    .from(projectGitConfigsTable)
    .where(eq(projectGitConfigsTable.repoPatId, repoPatId));
  return rows.map((r) => r.projectName).sort();
}

/**
 * Resolve the effective `{ provider, pat }` pair to use for a git
 * clone/push against the given row. Returns `null` when the row is
 * malformed (no inline PAT and no linked Repo PAT, or a stale FK that
 * points at a deleted Repo PAT).
 */
export async function resolvePatForRow(
  cfg: ProjectGitConfig,
): Promise<{ provider: GitProvider; pat: string } | null> {
  if (cfg.repoPatId) {
    const linked = await loadLinkedPat(cfg.repoPatId);
    if (!linked) return null;
    return {
      provider: normalizeProvider(linked.provider),
      pat: decryptSecret(linked.patEncrypted),
    };
  }
  if (!cfg.patEncrypted) return null;
  return {
    provider: normalizeProvider(cfg.provider),
    pat: decryptSecret(cfg.patEncrypted),
  };
}

/**
 * Verify at boot that we can read every row in `project_git_configs`.
 * If the table has rows but `PROJECT_SECRETS_KEY` is missing or wrong,
 * fail fast with a clear error rather than waiting for the next pull
 * to surface the problem.
 */
export async function assertEncryptionKeyOnBoot(): Promise<void> {
  let rows: ProjectGitConfig[];
  try {
    rows = await db
      .select()
      .from(projectGitConfigsTable)
      .where(isNotNull(projectGitConfigsTable.patEncrypted))
      .limit(1);
  } catch {
    // Table might not exist yet (pre-`db push`). Nothing to verify.
    return;
  }
  if (rows.length === 0) return;
  try {
    decryptSecret(rows[0]!.patEncrypted!);
  } catch (err) {
    logger.error(
      { err },
      "PROJECT_SECRETS_KEY is missing or wrong; cannot decrypt stored Azure Repos PATs",
    );
    throw err;
  }
}

import { eq } from "drizzle-orm";
import { db, projectGitConfigsTable } from "@workspace/db";
import { encryptSecret, getProjectSecretsKey } from "@/shared/crypto";
import {
  isGitProvider,
  normalizeProvider,
  SUPPORTED_PROVIDERS,
  type GitProvider,
} from "@/features/projects/infrastructure/git/gitProvider";
import { validateRepoUrl } from "@/features/projects/infrastructure/git/gitProviderRegistry";
import {
  getGitConfig,
  loadGitConfigRow,
  loadLinkedPat,
  type PublicGitConfig,
} from "@/features/projects/infrastructure/gitConfigRepository";

export interface UpsertGitConfigInput {
  projectName: string;
  /**
   * `azure_repos` / `github` — store an inline PAT on the row.
   * `existing_pat` — bind the row to a shared `repo_pats` row identified
   * by `repoPatId`; the effective provider is taken from that PAT.
   */
  provider: GitProvider | "existing_pat";
  repoUrl: string;
  branch: string;
  /** New PAT, or null to keep existing. Must be null for `existing_pat`. */
  pat: string | null;
  /** Required when provider === "existing_pat". */
  repoPatId: string | null;
  updatedByUserId: string;
}

/**
 * Ports the use case depends on. Defaults wire up the live drizzle +
 * repository + provider implementations; tests supply fakes.
 */
export interface UpsertGitConfigDeps {
  loadExisting: typeof loadGitConfigRow;
  loadLinkedPat: typeof loadLinkedPat;
  validateRepoUrl: typeof validateRepoUrl;
  read: typeof getGitConfig;
  insertRow: (row: typeof projectGitConfigsTable.$inferInsert) => Promise<void>;
  updateRow: (
    projectName: string,
    row: Partial<typeof projectGitConfigsTable.$inferInsert>,
  ) => Promise<void>;
  encryptSecret: typeof encryptSecret;
  getProjectSecretsKey: typeof getProjectSecretsKey;
}

const defaultDeps: UpsertGitConfigDeps = {
  loadExisting: loadGitConfigRow,
  loadLinkedPat,
  validateRepoUrl,
  read: getGitConfig,
  async insertRow(row) {
    await db.insert(projectGitConfigsTable).values(row);
  },
  async updateRow(projectName, row) {
    await db
      .update(projectGitConfigsTable)
      .set(row)
      .where(eq(projectGitConfigsTable.projectName, projectName));
  },
  encryptSecret,
  getProjectSecretsKey,
};

export async function upsertGitConfig(
  input: UpsertGitConfigInput,
  deps: UpsertGitConfigDeps = defaultDeps,
): Promise<PublicGitConfig> {
  const branch = input.branch.trim();
  if (!branch) throw new Error("Branch is required");

  const existing = await deps.loadExisting(input.projectName);

  if (input.provider === "existing_pat") {
    if (!input.repoPatId) {
      throw new Error("Existing Repo PAT is required");
    }
    if (input.pat !== null && input.pat !== "") {
      throw new Error(
        'Cannot supply both an inline "pat" and a "repoPatId" — choose one source for the Personal Access Token.',
      );
    }
    const linked = await deps.loadLinkedPat(input.repoPatId);
    if (!linked) {
      throw new Error("Selected Repo PAT no longer exists");
    }
    const linkedProvider = normalizeProvider(linked.provider);
    const repoUrl = deps.validateRepoUrl(linkedProvider, input.repoUrl);
    if (existing) {
      await deps.updateRow(input.projectName, {
        provider: linkedProvider,
        repoUrl,
        branch,
        patEncrypted: null,
        patLastFour: null,
        patSetAt: null,
        repoPatId: input.repoPatId,
        updatedByUserId: input.updatedByUserId,
        updatedAt: new Date(),
      });
    } else {
      await deps.insertRow({
        projectName: input.projectName,
        provider: linkedProvider,
        repoUrl,
        branch,
        patEncrypted: null,
        patLastFour: null,
        patSetAt: null,
        repoPatId: input.repoPatId,
        updatedByUserId: input.updatedByUserId,
      });
    }
    return deps.read(input.projectName);
  }

  if (!isGitProvider(input.provider)) {
    throw new Error(
      `Unsupported git provider "${String(input.provider)}". Expected one of: ${SUPPORTED_PROVIDERS.join(", ")}, existing_pat`,
    );
  }
  const provider = input.provider;
  const repoUrl = deps.validateRepoUrl(provider, input.repoUrl);

  // Inline-PAT path. If the existing row was previously bound to a
  // shared Repo PAT, the caller MUST supply a fresh inline PAT.
  const wasUsingSharedPat = !!existing?.repoPatId;

  if (input.pat === null) {
    if (!existing) {
      throw new Error("Personal Access Token is required");
    }
    if (wasUsingSharedPat) {
      throw new Error(
        "This project is currently bound to a shared Repo PAT. Provide a new Personal Access Token to switch to an inline PAT.",
      );
    }
    await deps.updateRow(input.projectName, {
      provider,
      repoUrl,
      branch,
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date(),
    });
  } else {
    const pat = input.pat.trim();
    if (pat.length < 8) {
      throw new Error("Personal Access Token looks too short");
    }
    // Prove the encryption key is configured before writing.
    deps.getProjectSecretsKey();
    const patEncrypted = deps.encryptSecret(pat);
    const patLastFour = pat.slice(-4);
    if (existing) {
      await deps.updateRow(input.projectName, {
        provider,
        repoUrl,
        branch,
        patEncrypted,
        patLastFour,
        patSetAt: new Date(),
        repoPatId: null,
        updatedByUserId: input.updatedByUserId,
        updatedAt: new Date(),
      });
    } else {
      await deps.insertRow({
        projectName: input.projectName,
        provider,
        repoUrl,
        branch,
        patEncrypted,
        patLastFour,
        patSetAt: new Date(),
        repoPatId: null,
        updatedByUserId: input.updatedByUserId,
      });
    }
  }
  return deps.read(input.projectName);
}

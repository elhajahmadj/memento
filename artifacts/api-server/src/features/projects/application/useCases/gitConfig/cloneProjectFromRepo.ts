import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, projectGitConfigsTable } from "@workspace/db";
import {
  encryptSecret,
  decryptSecret,
  getProjectSecretsKey,
} from "@/shared/crypto";
import { logger } from "@/shared/logger";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  isGitProvider,
  normalizeProvider,
  type GitProvider,
} from "@/features/projects/infrastructure/git/gitProvider";
import {
  injectPatIntoUrl,
  validateRepoUrl,
} from "@/features/projects/infrastructure/git/gitProviderRegistry";
import {
  runGit,
  type GitRunner,
} from "@/features/projects/infrastructure/git/gitCli";
import {
  classifyGitError,
  type CloneErrorCode,
} from "@/features/projects/infrastructure/git/gitErrorClassifier";
import { safeRm } from "@/features/projects/infrastructure/git/fsHelpers";
import { loadLinkedPat } from "@/features/projects/infrastructure/gitConfigRepository";

export type { CloneErrorCode };

export interface CloneErrorResult {
  ok: false;
  code: CloneErrorCode;
  message: string;
}

export interface CloneSuccessResult {
  ok: true;
  solutionName: string;
  rootPath: string;
}

export type CloneResult = CloneSuccessResult | CloneErrorResult;

export interface CloneInput {
  solutionName: string;
  provider: GitProvider | "existing_pat";
  repoUrl: string;
  branch: string;
  pat: string | null;
  repoPatId: string | null;
  actingUserId: string;
}

export interface CloneProjectDeps {
  runGit: GitRunner;
  loadLinkedPat: typeof loadLinkedPat;
  workspaceDir: () => string;
}

const defaultDeps: CloneProjectDeps = {
  runGit,
  loadLinkedPat,
  workspaceDir: () => recorderConfig.workspaceDir,
};

export async function cloneProjectFromRepo(
  input: CloneInput,
  deps: CloneProjectDeps = defaultDeps,
): Promise<CloneResult> {
  const solutionName = input.solutionName.trim();
  const branch = input.branch.trim();
  const validId = /^[A-Za-z][A-Za-z0-9_.-]*$/;
  if (!solutionName || !validId.test(solutionName)) {
    return {
      ok: false,
      code: "invalid_input",
      message: "Invalid project name.",
    };
  }
  if (!branch) {
    return { ok: false, code: "invalid_input", message: "Branch is required." };
  }

  let provider: GitProvider;
  let pat: string;
  if (input.provider === "existing_pat") {
    if (!input.repoPatId) {
      return {
        ok: false,
        code: "invalid_input",
        message: "Existing Repo PAT is required.",
      };
    }
    if (input.pat !== null && input.pat !== "") {
      return {
        ok: false,
        code: "invalid_input",
        message:
          'Cannot supply both an inline "pat" and a "repoPatId" — choose one source for the Personal Access Token.',
      };
    }
    const linked = await deps.loadLinkedPat(input.repoPatId);
    if (!linked) {
      return {
        ok: false,
        code: "invalid_input",
        message: "Selected Repo PAT no longer exists.",
      };
    }
    provider = normalizeProvider(linked.provider);
    try {
      pat = decryptSecret(linked.patEncrypted);
    } catch {
      return {
        ok: false,
        code: "git_failed",
        message: "Failed to decrypt the selected Repo PAT.",
      };
    }
  } else {
    if (!isGitProvider(input.provider)) {
      return {
        ok: false,
        code: "invalid_input",
        message: `Unsupported git provider "${String(input.provider)}".`,
      };
    }
    provider = input.provider;
    const candidate = (input.pat ?? "").trim();
    if (candidate.length < 8) {
      return {
        ok: false,
        code: "invalid_input",
        message: "Personal Access Token is required.",
      };
    }
    try {
      getProjectSecretsKey();
    } catch (err) {
      return {
        ok: false,
        code: "git_failed",
        message: (err as Error).message,
      };
    }
    pat = candidate;
  }

  let repoUrl: string;
  try {
    repoUrl = validateRepoUrl(provider, input.repoUrl);
  } catch (err) {
    return {
      ok: false,
      code: "invalid_input",
      message: (err as Error).message,
    };
  }

  const workspaceDir = deps.workspaceDir();
  await fs.mkdir(workspaceDir, { recursive: true });
  const rootPath = path.join(workspaceDir, solutionName);
  try {
    await fs.access(rootPath);
    return {
      ok: false,
      code: "project_exists",
      message: `A project named "${solutionName}" already exists.`,
    };
  } catch {
    // does not exist — good
  }

  const existingRow = (
    await db
      .select()
      .from(projectGitConfigsTable)
      .where(eq(projectGitConfigsTable.projectName, solutionName))
      .limit(1)
  )[0];
  if (existingRow) {
    return {
      ok: false,
      code: "project_exists",
      message: `A project named "${solutionName}" already has Git configuration.`,
    };
  }

  const cloneUrl = injectPatIntoUrl(provider, repoUrl, pat);

  const tmpDir = await fs.mkdtemp(
    path.join(workspaceDir, `.memento-gitclone-${solutionName}-`),
  );
  const cloneInto = path.join(tmpDir, "clone");

  let movedIntoPlace = false;
  try {
    const cloneResult = await deps.runGit(
      ["clone", "--depth", "1", "--branch", branch, cloneUrl, cloneInto],
      { pat },
    );
    if (cloneResult.code !== 0) {
      logger.warn(
        { project: solutionName, stderr: cloneResult.stderr },
        "git clone (new project) failed",
      );
      const code = classifyGitError(cloneResult.stderr);
      const mapped: CloneErrorCode =
        code === "not_a_memento_project" ? "git_failed" : code;
      return {
        ok: false,
        code: mapped,
        message:
          mapped === "auth_failed"
            ? "Authentication failed. Check the Personal Access Token."
            : mapped === "repo_not_found"
              ? "Repository not found at that URL."
              : mapped === "branch_not_found"
                ? `Branch "${branch}" was not found in the remote repository.`
                : "git clone failed. See server logs for details.",
      };
    }

    await safeRm(path.join(cloneInto, ".git"));

    try {
      await fs.rename(cloneInto, rootPath);
      movedIntoPlace = true;
    } catch (err) {
      logger.error(
        { err, project: solutionName },
        "Failed to move cloned project into place",
      );
      return {
        ok: false,
        code: "git_failed",
        message: "Failed to install cloned files into the workspace.",
      };
    }

    try {
      if (input.provider === "existing_pat") {
        await db.insert(projectGitConfigsTable).values({
          projectName: solutionName,
          provider,
          repoUrl,
          branch,
          patEncrypted: null,
          patLastFour: null,
          patSetAt: null,
          repoPatId: input.repoPatId,
          updatedByUserId: input.actingUserId,
        });
      } else {
        const patEncrypted = encryptSecret(pat);
        const patLastFour = pat.slice(-4);
        await db.insert(projectGitConfigsTable).values({
          projectName: solutionName,
          provider,
          repoUrl,
          branch,
          patEncrypted,
          patLastFour,
          patSetAt: new Date(),
          repoPatId: null,
          updatedByUserId: input.actingUserId,
        });
      }
    } catch (err) {
      logger.error(
        { err, project: solutionName },
        "Failed to persist project_git_configs row after clone",
      );
      if (movedIntoPlace) await safeRm(rootPath);
      return {
        ok: false,
        code: "git_failed",
        message: "Failed to save Git configuration for the cloned project.",
      };
    }

    return { ok: true, solutionName, rootPath };
  } finally {
    await safeRm(tmpDir);
  }
}

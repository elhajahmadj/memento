import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "@/shared/logger";
import { listAvailableProjects } from "@/features/projects/infrastructure/projectService";
import { loadMyForkForPush } from "@/features/projects/infrastructure/userProjectForkService";
import { injectPatIntoUrl } from "@/features/projects/infrastructure/git/gitProviderRegistry";
import {
  runGit,
  type GitRunner,
} from "@/features/projects/infrastructure/git/gitCli";
import {
  classifyGitError,
  classifyPushError,
  type PushErrorCode,
} from "@/features/projects/infrastructure/git/gitErrorClassifier";
import {
  safeRm,
  clearDirExcept,
  copyTreeInto,
} from "@/features/projects/infrastructure/git/fsHelpers";
import { readCurrentBranch } from "@/features/projects/infrastructure/git/gitWorkingCopy";
import {
  loadGitConfigRow,
  resolvePatForRow,
} from "@/features/projects/infrastructure/gitConfigRepository";

export type { PushErrorCode };

export interface PushErrorResult {
  ok: false;
  code: PushErrorCode;
  message: string;
}

export interface PushSuccessResult {
  ok: true;
  /** Null when the working tree matched the remote — nothing was pushed. */
  commitSha: string | null;
  nothingToCommit: boolean;
}

export type PushResult = PushSuccessResult | PushErrorResult;

export interface PushProjectDeps {
  runGit: GitRunner;
  loadGitConfigRow: typeof loadGitConfigRow;
  resolvePatForRow: typeof resolvePatForRow;
  listAvailableProjects: typeof listAvailableProjects;
  loadMyForkForPush: typeof loadMyForkForPush;
  readCurrentBranch: typeof readCurrentBranch;
}

const defaultDeps: PushProjectDeps = {
  runGit,
  loadGitConfigRow,
  resolvePatForRow,
  listAvailableProjects,
  loadMyForkForPush,
  readCurrentBranch,
};

/**
 * Commit the current contents of the project directory and push them
 * back to the configured branch on the configured Git provider.
 *
 * Strategy: clone the configured branch into a temp dir, wipe its
 * working tree, copy the live project files in over the top, then
 * `git add -A` / `git commit` / `git push origin <branch>`. The
 * project directory on disk is never modified.
 */
export async function pushProject(
  projectName: string,
  commitMessage: string,
  actingUserId: string,
  deps: PushProjectDeps = defaultDeps,
): Promise<PushResult> {
  const trimmedMessage = commitMessage.trim();
  if (!trimmedMessage) {
    return {
      ok: false,
      code: "git_failed",
      message: "Commit message is required.",
    };
  }

  const cfg = await deps.loadGitConfigRow(projectName);
  if (!cfg) {
    return {
      ok: false,
      code: "git_failed",
      message: "No Git provider is configured for this project.",
    };
  }
  const resolvedUpstream = await deps.resolvePatForRow(cfg);
  if (!resolvedUpstream) {
    return {
      ok: false,
      code: "git_failed",
      message:
        "Git configuration is incomplete (no PAT available). Open Configure and either set a PAT or pick an existing Repo PAT.",
    };
  }
  const upstreamProvider = resolvedUpstream.provider;
  const upstreamPat = resolvedUpstream.pat;
  const projects = await deps.listAvailableProjects();
  const found = projects.find((p) => p.solutionName === projectName);
  if (!found) {
    return {
      ok: false,
      code: "git_failed",
      message: "Project directory not found on disk.",
    };
  }
  const rootPath = path.dirname(found.slnPath);

  const myFork = await deps.loadMyForkForPush(actingUserId, projectName);
  const provider = myFork ? myFork.provider : upstreamProvider;
  const repoUrl = myFork ? myFork.repoUrl : cfg.repoUrl;
  const pat = myFork ? myFork.pat : upstreamPat;
  const cloneUrl = injectPatIntoUrl(provider, repoUrl, pat);
  const upstreamCloneUrl = injectPatIntoUrl(
    upstreamProvider,
    cfg.repoUrl,
    upstreamPat,
  );

  const workingBranch = await deps.readCurrentBranch(rootPath);
  const pushBranch = workingBranch ?? cfg.branch;

  const wsParent = path.dirname(rootPath);
  const tmpDir = await fs.mkdtemp(
    path.join(wsParent, `.memento-gitpush-${path.basename(rootPath)}-`),
  );
  const cloneInto = path.join(tmpDir, "clone");

  try {
    const cloneResult = await deps.runGit(
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        cfg.branch,
        upstreamCloneUrl,
        cloneInto,
      ],
      { pat: upstreamPat },
    );
    if (cloneResult.code !== 0) {
      logger.warn(
        { project: projectName, stderr: cloneResult.stderr },
        "git clone (push prep) failed",
      );
      const code = classifyGitError(cloneResult.stderr);
      return {
        ok: false,
        code: code === "not_a_memento_project" ? "git_failed" : code,
        message:
          code === "auth_failed"
            ? "Authentication failed. Check the Personal Access Token."
            : code === "repo_not_found"
              ? "Repository not found at that URL."
              : code === "branch_not_found"
                ? `Branch "${cfg.branch}" was not found in the remote repository.`
                : "git clone failed. See server logs for details.",
      };
    }

    if (pushBranch !== cfg.branch) {
      const fetchResult = await deps.runGit(
        ["fetch", "--depth", "1", "origin", pushBranch],
        { cwd: cloneInto, pat: upstreamPat },
      );
      if (fetchResult.code === 0) {
        const checkoutResult = await deps.runGit(
          ["checkout", "-B", pushBranch, "FETCH_HEAD"],
          { cwd: cloneInto, pat: upstreamPat },
        );
        if (checkoutResult.code !== 0) {
          logger.warn(
            { project: projectName, stderr: checkoutResult.stderr },
            "git checkout of fetched pushBranch failed",
          );
          return {
            ok: false,
            code: "git_failed",
            message:
              "Failed to base commit on remote branch. See server logs for details.",
          };
        }
      } else {
        const createResult = await deps.runGit(
          ["checkout", "-b", pushBranch],
          { cwd: cloneInto, pat: upstreamPat },
        );
        if (createResult.code !== 0) {
          logger.warn(
            { project: projectName, stderr: createResult.stderr },
            "git checkout -b for first push of new branch failed",
          );
          return {
            ok: false,
            code: "git_failed",
            message:
              "Failed to prepare new branch. See server logs for details.",
          };
        }
      }
    }

    if (myFork) {
      const setUrlResult = await deps.runGit(
        ["remote", "set-url", "origin", cloneUrl],
        { cwd: cloneInto, pat },
      );
      if (setUrlResult.code !== 0) {
        logger.warn(
          { project: projectName, stderr: setUrlResult.stderr },
          "git remote set-url (fork) failed",
        );
        return {
          ok: false,
          code: "git_failed",
          message: "Failed to re-target push to personal fork.",
        };
      }
    }

    await clearDirExcept(cloneInto, new Set([".git"]));
    await copyTreeInto(rootPath, cloneInto, new Set([".git"]));

    const gitAuthorArgs = [
      "-c",
      "user.name=memento",
      "-c",
      "user.email=memento@local",
    ];

    const addResult = await deps.runGit(["add", "-A"], {
      cwd: cloneInto,
      pat,
    });
    if (addResult.code !== 0) {
      logger.warn(
        { project: projectName, stderr: addResult.stderr },
        "git add failed",
      );
      return {
        ok: false,
        code: "git_failed",
        message: "git add failed. See server logs for details.",
      };
    }

    const diffResult = await deps.runGit(["diff", "--cached", "--quiet"], {
      cwd: cloneInto,
      pat,
    });
    if (diffResult.code === 0) {
      return { ok: true, commitSha: null, nothingToCommit: true };
    }

    const commitResult = await deps.runGit(
      [...gitAuthorArgs, "commit", "-m", trimmedMessage],
      { cwd: cloneInto, pat },
    );
    if (commitResult.code !== 0) {
      logger.warn(
        { project: projectName, stderr: commitResult.stderr },
        "git commit failed",
      );
      return {
        ok: false,
        code: "git_failed",
        message: "git commit failed. See server logs for details.",
      };
    }

    const pushResult = await deps.runGit(
      ["push", "origin", `HEAD:${pushBranch}`],
      { cwd: cloneInto, pat },
    );
    if (pushResult.code !== 0) {
      logger.warn(
        { project: projectName, stderr: pushResult.stderr },
        "git push failed",
      );
      const code = classifyPushError(pushResult.stderr);
      return {
        ok: false,
        code,
        message:
          code === "auth_failed"
            ? "Authentication failed. Check the Personal Access Token."
            : code === "repo_not_found"
              ? "Repository not found at that URL."
              : code === "branch_not_found"
                ? `Branch "${pushBranch}" was not found in the remote repository.`
                : code === "push_rejected"
                  ? `Push rejected — the remote branch "${pushBranch}" has new commits. Pull first, then retry.`
                  : "git push failed. See server logs for details.",
      };
    }

    const shaResult = await deps.runGit(["rev-parse", "HEAD"], {
      cwd: cloneInto,
      pat,
    });
    const commitSha = shaResult.stdout.trim();

    return { ok: true, commitSha, nothingToCommit: false };
  } finally {
    await safeRm(tmpDir);
  }
}

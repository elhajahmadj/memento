import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "@/shared/logger";
import { listAvailableProjects } from "@/features/projects/infrastructure/projectService";
import { PROJECT_MARKER_FILE } from "@/features/projects/infrastructure/git/gitProvider";
import { injectPatIntoUrl } from "@/features/projects/infrastructure/git/gitProviderRegistry";
import {
  runGit,
  type GitRunner,
} from "@/features/projects/infrastructure/git/gitCli";
import {
  classifyGitError,
  type PullErrorCode,
} from "@/features/projects/infrastructure/git/gitErrorClassifier";
import { safeRm } from "@/features/projects/infrastructure/git/fsHelpers";
import {
  loadGitConfigRow,
  resolvePatForRow,
} from "@/features/projects/infrastructure/gitConfigRepository";

export type { PullErrorCode };

export interface PullErrorResult {
  ok: false;
  code: PullErrorCode;
  message: string;
}

export interface PullSuccessResult {
  ok: true;
  commitSha: string;
  commitMessage: string;
  backupPath: string | null;
}

export type PullResult = PullSuccessResult | PullErrorResult;

export interface PullProjectDeps {
  runGit: GitRunner;
  loadGitConfigRow: typeof loadGitConfigRow;
  resolvePatForRow: typeof resolvePatForRow;
  listAvailableProjects: typeof listAvailableProjects;
}

const defaultDeps: PullProjectDeps = {
  runGit,
  loadGitConfigRow,
  resolvePatForRow,
  listAvailableProjects,
};

/**
 * Atomically replace `<rootPath>` with a fresh shallow clone of the
 * configured branch. The previous contents are kept in
 * `<rootPath>.bak-<timestamp>` for one-step manual rollback.
 */
export async function pullProject(
  projectName: string,
  actingUserId: string,
  deps: PullProjectDeps = defaultDeps,
): Promise<PullResult> {
  void actingUserId;
  const cfg = await deps.loadGitConfigRow(projectName);
  if (!cfg) {
    return {
      ok: false,
      code: "git_failed",
      message: "No Git provider is configured for this project.",
    };
  }
  const resolved = await deps.resolvePatForRow(cfg);
  if (!resolved) {
    return {
      ok: false,
      code: "git_failed",
      message:
        "Git configuration is incomplete (no PAT available). Open Configure and either set a PAT or pick an existing Repo PAT.",
    };
  }
  const { provider, pat } = resolved;
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
  const cloneUrl = injectPatIntoUrl(provider, cfg.repoUrl, pat);

  const wsParent = path.dirname(rootPath);
  const tmpDir = await fs.mkdtemp(
    path.join(wsParent, `.memento-gitpull-${path.basename(rootPath)}-`),
  );
  const cloneInto = path.join(tmpDir, "clone");

  try {
    const cloneResult = await deps.runGit(
      ["clone", "--depth", "1", "--branch", cfg.branch, cloneUrl, cloneInto],
      { pat },
    );
    if (cloneResult.code !== 0) {
      logger.warn(
        { project: projectName, stderr: cloneResult.stderr },
        "git clone failed",
      );
      const code = classifyGitError(cloneResult.stderr);
      return {
        ok: false,
        code,
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

    const markerInClone = path.join(cloneInto, PROJECT_MARKER_FILE);
    let hasMarker = false;
    try {
      await fs.access(markerInClone);
      hasMarker = true;
    } catch {
      hasMarker = false;
    }
    if (!hasMarker) {
      const expected = path.basename(found.slnPath);
      try {
        await fs.access(path.join(cloneInto, expected));
      } catch {
        return {
          ok: false,
          code: "not_a_memento_project",
          message: `The cloned repository does not look like a memento project (missing ${PROJECT_MARKER_FILE} or ${expected}).`,
        };
      }
      try {
        await fs.copyFile(
          path.join(rootPath, PROJECT_MARKER_FILE),
          markerInClone,
        );
      } catch {
        // No marker on disk either — best-effort.
      }
    }

    const logResult = await deps.runGit(["log", "-1", "--pretty=%H%n%s"], {
      cwd: cloneInto,
      pat,
    });
    const lines = logResult.stdout.split("\n");
    const commitSha = (lines[0] ?? "").trim();
    const commitMessage = (lines[1] ?? "").trim();

    // SECURITY: strip the credential-bearing URL from .git/config so
    // the PAT doesn't sit on disk inside the project directory.
    const sanitizeRemote = await deps.runGit(
      ["remote", "set-url", "origin", cfg.repoUrl],
      { cwd: cloneInto, pat },
    );
    if (sanitizeRemote.code !== 0) {
      logger.error(
        { project: projectName, stderr: sanitizeRemote.stderr },
        "Failed to strip PAT from cloned .git/config; aborting pull",
      );
      return {
        ok: false,
        code: "git_failed",
        message:
          "Internal error while sanitizing clone credentials. See server logs.",
      };
    }

    const baseName = path.basename(rootPath);
    try {
      const siblings = await fs.readdir(wsParent);
      await Promise.all(
        siblings
          .filter((s) => s.startsWith(`${baseName}.bak-`))
          .map((s) => safeRm(path.join(wsParent, s))),
      );
    } catch {
      // ignore
    }

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(wsParent, `${baseName}.bak-${ts}`);
    let backupCreated = false;
    try {
      await fs.rename(rootPath, backupPath);
      backupCreated = true;
    } catch (err) {
      logger.warn(
        { err, project: projectName },
        "Failed to back up existing project directory before pull",
      );
    }
    try {
      await fs.rename(cloneInto, rootPath);
    } catch (err) {
      if (backupCreated) {
        try {
          await fs.rename(backupPath, rootPath);
        } catch {
          // best-effort
        }
      }
      logger.error({ err, project: projectName }, "Failed to swap in clone");
      return {
        ok: false,
        code: "git_failed",
        message: "Failed to swap pulled files into place.",
      };
    }

    return {
      ok: true,
      commitSha,
      commitMessage,
      backupPath: backupCreated ? backupPath : null,
    };
  } finally {
    await safeRm(tmpDir);
  }
}

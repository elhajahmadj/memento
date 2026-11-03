import path from "node:path";
import { listAvailableProjects } from "@/features/projects/infrastructure/projectService";
import {
  runGit,
  type GitRunner,
} from "@/features/projects/infrastructure/git/gitCli";
import { isOverwriteRefusal } from "@/features/projects/infrastructure/git/gitErrorClassifier";
import {
  hasGitDir,
  readCurrentBranch,
  validateBranchName,
} from "@/features/projects/infrastructure/git/gitWorkingCopy";

export type BranchOpErrorCode =
  | "no_git_working_copy"
  | "invalid_name"
  | "already_exists"
  | "not_found"
  | "dirty_working_copy"
  | "git_failed";

export interface BranchListResult {
  hasGitWorkingCopy: boolean;
  current: string | null;
  branches: string[];
}

export interface BranchOpSuccess {
  ok: true;
  current: string | null;
}

export interface BranchOpError {
  ok: false;
  code: BranchOpErrorCode;
  message: string;
  current: string | null;
}

export type BranchOpResult = BranchOpSuccess | BranchOpError;

export interface BranchOpsDeps {
  runGit: GitRunner;
  listAvailableProjects: typeof listAvailableProjects;
  hasGitDir: typeof hasGitDir;
  readCurrentBranch: typeof readCurrentBranch;
}

const defaultDeps: BranchOpsDeps = {
  runGit,
  listAvailableProjects,
  hasGitDir,
  readCurrentBranch,
};

const NO_GIT: BranchListResult = {
  hasGitWorkingCopy: false,
  current: null,
  branches: [],
};

async function resolveProjectRoot(
  projectName: string,
  deps: BranchOpsDeps,
): Promise<string | null> {
  const projects = await deps.listAvailableProjects();
  const found = projects.find((p) => p.solutionName === projectName);
  return found ? path.dirname(found.slnPath) : null;
}

export async function listBranches(
  projectName: string,
  deps: BranchOpsDeps = defaultDeps,
): Promise<BranchListResult> {
  const rootPath = await resolveProjectRoot(projectName, deps);
  if (!rootPath) return NO_GIT;
  if (!(await deps.hasGitDir(rootPath))) return NO_GIT;
  const list = await deps.runGit(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    { cwd: rootPath, pat: null },
  );
  if (list.code !== 0) return NO_GIT;
  const branches = list.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const current = await deps.readCurrentBranch(rootPath, deps.runGit);
  return { hasGitWorkingCopy: true, current, branches };
}

export async function createBranch(
  projectName: string,
  name: string,
  options: { checkout?: boolean } = {},
  deps: BranchOpsDeps = defaultDeps,
): Promise<BranchOpResult> {
  const rootPath = await resolveProjectRoot(projectName, deps);
  if (!rootPath || !(await deps.hasGitDir(rootPath))) {
    return {
      ok: false,
      code: "no_git_working_copy",
      message:
        "This project does not have a Git working copy yet. Pull from the remote first.",
      current: null,
    };
  }
  const validated = validateBranchName(name);
  if (!validated) {
    return {
      ok: false,
      code: "invalid_name",
      message:
        "Branch name is invalid. Avoid spaces and the characters ~ ^ : ? * [ \\.",
      current: await deps.readCurrentBranch(rootPath, deps.runGit),
    };
  }
  const checkResult = await deps.runGit(
    ["show-ref", "--verify", "--quiet", `refs/heads/${validated}`],
    { cwd: rootPath, pat: null },
  );
  if (checkResult.code === 0) {
    return {
      ok: false,
      code: "already_exists",
      message: `A branch named "${validated}" already exists.`,
      current: await deps.readCurrentBranch(rootPath, deps.runGit),
    };
  }
  const wantCheckout = options.checkout !== false;
  const args = wantCheckout
    ? ["checkout", "-b", validated]
    : ["branch", validated];
  const r = await deps.runGit(args, { cwd: rootPath, pat: null });
  if (r.code !== 0) {
    return {
      ok: false,
      code: "git_failed",
      message: r.stderr.trim() || "git failed to create the branch.",
      current: await deps.readCurrentBranch(rootPath, deps.runGit),
    };
  }
  return { ok: true, current: await deps.readCurrentBranch(rootPath, deps.runGit) };
}

export async function checkoutBranch(
  projectName: string,
  name: string,
  options: { force?: boolean } = {},
  deps: BranchOpsDeps = defaultDeps,
): Promise<BranchOpResult> {
  const rootPath = await resolveProjectRoot(projectName, deps);
  if (!rootPath || !(await deps.hasGitDir(rootPath))) {
    return {
      ok: false,
      code: "no_git_working_copy",
      message:
        "This project does not have a Git working copy yet. Pull from the remote first.",
      current: null,
    };
  }
  const validated = validateBranchName(name);
  if (!validated) {
    return {
      ok: false,
      code: "invalid_name",
      message: "Branch name is invalid.",
      current: await deps.readCurrentBranch(rootPath, deps.runGit),
    };
  }
  const checkResult = await deps.runGit(
    ["show-ref", "--verify", "--quiet", `refs/heads/${validated}`],
    { cwd: rootPath, pat: null },
  );
  if (checkResult.code !== 0) {
    return {
      ok: false,
      code: "not_found",
      message: `Branch "${validated}" does not exist locally.`,
      current: await deps.readCurrentBranch(rootPath, deps.runGit),
    };
  }
  const args = options.force
    ? ["checkout", "--force", validated]
    : ["checkout", validated];
  const r = await deps.runGit(args, { cwd: rootPath, pat: null });
  if (r.code !== 0) {
    if (!options.force && isOverwriteRefusal(r.stderr)) {
      return {
        ok: false,
        code: "dirty_working_copy",
        message:
          "The working copy has uncommitted changes that would be lost on this branch switch. Confirm to discard them.",
        current: await deps.readCurrentBranch(rootPath, deps.runGit),
      };
    }
    return {
      ok: false,
      code: "git_failed",
      message: r.stderr.trim() || "git failed to check out the branch.",
      current: await deps.readCurrentBranch(rootPath, deps.runGit),
    };
  }
  return { ok: true, current: await deps.readCurrentBranch(rootPath, deps.runGit) };
}

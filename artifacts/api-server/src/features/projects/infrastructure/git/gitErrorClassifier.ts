export type PullErrorCode =
  | "auth_failed"
  | "repo_not_found"
  | "branch_not_found"
  | "not_a_memento_project"
  | "git_failed";

export type PushErrorCode =
  | "auth_failed"
  | "repo_not_found"
  | "branch_not_found"
  | "push_rejected"
  | "git_failed";

export type CloneErrorCode =
  | "auth_failed"
  | "repo_not_found"
  | "branch_not_found"
  | "project_exists"
  | "invalid_input"
  | "git_failed";

export function classifyGitError(stderr: string): PullErrorCode {
  const s = stderr.toLowerCase();
  if (
    s.includes("authentication failed") ||
    s.includes("invalid username or token") ||
    s.includes("could not read username") ||
    s.includes("403") ||
    s.includes("401")
  ) {
    return "auth_failed";
  }
  if (
    s.includes("repository not found") ||
    /repository\s+['`"].*['`"]\s+not found/.test(s) ||
    s.includes("does not appear to be a git repository") ||
    s.includes("could not resolve host") ||
    s.includes("does not exist") ||
    s.includes("404")
  ) {
    return "repo_not_found";
  }
  if (
    s.includes("remote branch") ||
    s.includes("could not find remote branch") ||
    s.includes("not found in upstream")
  ) {
    return "branch_not_found";
  }
  return "git_failed";
}

export function classifyPushError(stderr: string): PushErrorCode {
  const s = stderr.toLowerCase();
  if (
    s.includes("authentication failed") ||
    s.includes("invalid username or token") ||
    s.includes("could not read username") ||
    s.includes("403") ||
    s.includes("401")
  ) {
    return "auth_failed";
  }
  if (
    s.includes("repository not found") ||
    /repository\s+['`"].*['`"]\s+not found/.test(s) ||
    s.includes("does not appear to be a git repository") ||
    s.includes("could not resolve host") ||
    s.includes("does not exist") ||
    s.includes("404")
  ) {
    return "repo_not_found";
  }
  if (
    s.includes("rejected") &&
    (s.includes("non-fast-forward") ||
      s.includes("fetch first") ||
      s.includes("hook declined") ||
      s.includes("pre-receive hook") ||
      s.includes("protected branch"))
  ) {
    return "push_rejected";
  }
  if (
    s.includes("remote branch") ||
    s.includes("could not find remote branch") ||
    s.includes("not found in upstream")
  ) {
    return "branch_not_found";
  }
  return "git_failed";
}

/**
 * True when git's checkout stderr says the operation was refused
 * because uncommitted working-copy changes would be overwritten.
 */
export function isOverwriteRefusal(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes("would be overwritten") ||
    s.includes("local changes to the following files would be overwritten") ||
    s.includes("please commit your changes or stash them")
  );
}

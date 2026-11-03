import { spawn } from "node:child_process";

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitRunOptions {
  cwd?: string;
  /** The PAT (if any) embedded in the git command — used to redact it from captured output. */
  pat: string | null;
}

/**
 * Redact a PAT (and any other `https://<user>:<token>@host` credentials)
 * from arbitrary git CLI output. Always run captured stdout/stderr
 * through this before logging or returning to a caller.
 */
export function redactPatFromGitOutput(
  text: string,
  pat: string | null,
): string {
  let out = text;
  if (pat) out = out.split(pat).join("***");
  out = out.replace(/https:\/\/[^/\s@]+:[^/\s@]+@/g, "https://***@");
  return out;
}

export function runGit(
  args: string[],
  opts: GitRunOptions,
): Promise<GitRunResult> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      resolve({
        code: code ?? -1,
        stdout: redactPatFromGitOutput(stdout, opts.pat),
        stderr: redactPatFromGitOutput(stderr, opts.pat),
      });
    });
    proc.on("error", (err) => {
      resolve({
        code: -1,
        stdout: "",
        stderr: redactPatFromGitOutput(String(err), opts.pat),
      });
    });
  });
}

/** A `runGit`-compatible port — let tests inject a fake without touching child_process. */
export type GitRunner = (
  args: string[],
  opts: GitRunOptions,
) => Promise<GitRunResult>;

import fs from "node:fs/promises";
import path from "node:path";
import { runGit, type GitRunner } from "./gitCli";

export async function hasGitDir(rootPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(rootPath, ".git"));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function readCurrentBranch(
  rootPath: string,
  run: GitRunner = runGit,
): Promise<string | null> {
  if (!(await hasGitDir(rootPath))) return null;
  const r = await run(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: rootPath,
    pat: null,
  });
  if (r.code !== 0) return null;
  const name = r.stdout.trim();
  return name && name !== "HEAD" ? name : null;
}

// Match `git check-ref-format --branch` rules conservatively. Rejects:
// whitespace, control chars, the characters git itself refuses
// (` ~ ^ : ? * [ \ ..), leading "-" / "/", and trailing "/" / ".lock".
export function validateBranchName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return null;
  if (/\s/.test(name)) return null;
  if (/[\x00-\x1f\x7f~^:?*[\\]/.test(name)) return null;
  if (name.includes("..")) return null;
  if (name.startsWith("-") || name.startsWith("/")) return null;
  if (name.endsWith("/") || name.endsWith(".lock")) return null;
  if (name === "@" || name.includes("@{")) return null;
  return name;
}

/**
 * Hook body backups: when the recorder is about to overwrite a hook
 * (`BeforeEachAsync` / `OneTimeSetUpAsync`) whose body is anything other
 * than the default scaffold stub, the previous body is stashed alongside
 * the source file as a `.bak` so the user can recover it. The
 * `clearHookBackups` sweep removes every matching `.bak` across the
 * project tree.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Project } from "@/features/projects/domain/types";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import {
  DEFAULT_HOOK_BACKUP_RETENTION,
  getHookBackupRetention,
} from "@/features/settings/infrastructure/settings";

/**
 * Default cap on `.bak` snapshots retained per (test class, hook) pair when
 * the user has not customised it via Settings. Bounding this per-pair
 * (rather than per-directory) keeps two hooks in the same test class from
 * evicting each other's history when one is recorded frequently. After
 * every successful backup write we prune the oldest files matching the
 * same `${stem}.${method}.*.bak` shape down to the configured cap (see
 * `getHookBackupRetention` in `./settings`).
 *
 * Re-exported so existing callers and tests that imported the old
 * `HOOK_BACKUP_RETENTION` constant continue to compile.
 */
export const HOOK_BACKUP_RETENTION = DEFAULT_HOOK_BACKUP_RETENTION;

/**
 * Stash the previous hook body in a sibling `.bak` file so the user can
 * recover it after a recording overwrite. The filename embeds the test
 * class name, the hook method name, and a timestamp so prior backups are
 * never clobbered. The `.bak` extension keeps the file out of the C#
 * compile and runtime path. After writing, older backups for the same
 * (test class, hook) pair are pruned so the directory stays tidy
 * (see `HOOK_BACKUP_RETENTION`). Returns the project-relative path written.
 */
export async function writeHookBackup(
  project: Project,
  fileRelPath: string,
  method: string,
  body: string,
): Promise<string> {
  const dirRel = path.posix.dirname(fileRelPath.replace(/\\/g, "/"));
  const baseName = path.posix.basename(fileRelPath.replace(/\\/g, "/"));
  const stem = baseName.replace(/\.cs$/i, "");
  // Use millisecond precision plus a short random suffix so two backups
  // written in the same millisecond never collide and clobber each other.
  const stamp =
    new Date().toISOString().replace(/[:.]/g, "-") +
    "-" +
    Math.random().toString(36).slice(2, 8);
  const backupRel =
    (dirRel === "." ? "" : `${dirRel}/`) +
    `${stem}.${method}.${stamp}.bak`;
  const backupAbs = safeJoin(project.rootPath, backupRel);
  // Body is the raw text between the hook braces (no surrounding `{`/`}`).
  // Drop a leading blank line so the saved snippet starts on real content.
  const trimmedLeading = body.replace(/^\r?\n/, "");
  const trailing = trimmedLeading.endsWith("\n") ? "" : "\n";
  await fs.writeFile(backupAbs, trimmedLeading + trailing);
  await pruneHookBackups(project, dirRel, stem, method);
  return backupRel;
}

/**
 * Delete `.bak` files for the given (test class, hook) pair beyond the
 * `HOOK_BACKUP_RETENTION` cap, keeping the most recent. Files are scoped to
 * the matching `${stem}.${method}.` prefix so unrelated hooks (or unrelated
 * test classes) in the same folder are never touched. Sort key is the
 * embedded ISO timestamp portion of the filename, which sorts
 * lexicographically; the file written by the current call is always among
 * the kept set because it carries the newest stamp. Failures to unlink an
 * individual file are swallowed so a stray permission error doesn't break
 * the user-visible recording flow.
 */
async function pruneHookBackups(
  project: Project,
  dirRel: string,
  stem: string,
  method: string,
): Promise<void> {
  const dirAbs =
    dirRel === "." ? project.rootPath : safeJoin(project.rootPath, dirRel);
  let entries: string[];
  try {
    entries = await fs.readdir(dirAbs);
  } catch {
    return;
  }
  const prefix = `${stem}.${method}.`;
  const matches = entries
    .filter((name) => name.startsWith(prefix) && name.endsWith(".bak"))
    .sort();
  // Re-read the configured cap on every prune so a Settings change takes
  // effect on the very next recording without a server restart.
  const retention = await getHookBackupRetention();
  if (matches.length <= retention) return;
  const toDelete = matches.slice(0, matches.length - retention);
  await Promise.all(
    toDelete.map(async (name) => {
      try {
        await fs.unlink(path.join(dirAbs, name));
      } catch {
        // best-effort; leave stragglers rather than failing the recording
      }
    }),
  );
}

/**
 * Filename shape produced by `writeHookBackup`: `${stem}.${hookMethod}.${stamp}.bak`.
 * Anchoring on the hook method name (`BeforeEachAsync` / `OneTimeSetUpAsync`) plus
 * the trailing `.bak` keeps the maintenance "clear all" sweep from ever touching
 * a user-authored `.bak` file that doesn't follow this exact pattern.
 */
export const HOOK_BACKUP_NAME_RE =
  /^[^/\\]+\.(?:BeforeEachAsync|OneTimeSetUpAsync)\..+\.bak$/;

/**
 * Directory names skipped by the recursive sweep. Avoids descending into
 * build outputs and dependency caches that can never legitimately contain
 * hook backup files but might contain a lot of unrelated noise.
 */
const HOOK_BACKUP_SCAN_SKIP_DIRS = new Set([
  "bin",
  "obj",
  "node_modules",
  ".git",
  ".vs",
]);

/**
 * Walk the project's tree and delete every file whose name matches the
 * `${stem}.${hookMethod}.${stamp}.bak` pattern produced by
 * `writeHookBackup`. Returns the project-relative paths that were
 * actually removed (forward-slash separated, sorted) so the UI can
 * report a count and, if useful, a sample. Skips build/dependency
 * directories and silently swallows per-file unlink errors so a
 * stray permission issue can't fail the whole sweep.
 */
export async function clearHookBackups(
  project: Project,
): Promise<{ deletedCount: number; deletedPaths: string[] }> {
  const root = project.rootPath;
  const deleted: string[] = [];
  async function walk(dirAbs: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dirAbs, e.name);
      if (e.isDirectory()) {
        if (HOOK_BACKUP_SCAN_SKIP_DIRS.has(e.name)) continue;
        if (e.name.startsWith(".")) continue;
        await walk(abs);
      } else if (e.isFile() && HOOK_BACKUP_NAME_RE.test(e.name)) {
        try {
          await fs.unlink(abs);
          deleted.push(
            path.relative(root, abs).split(path.sep).join("/"),
          );
        } catch {
          // best-effort; leave stragglers rather than failing the sweep
        }
      }
    }
  }
  await walk(root);
  deleted.sort();
  return { deletedCount: deleted.length, deletedPaths: deleted };
}

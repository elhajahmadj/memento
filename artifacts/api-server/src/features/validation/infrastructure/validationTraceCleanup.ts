import fs from "node:fs/promises";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { db, validationRunsTable } from "@workspace/db";
import { logger } from "@/shared/logger";
import { getValidationTraceRetentionDays } from "@/features/settings/infrastructure/settings";

/**
 * Validation runs leave behind a trace zip and a final-state PNG under
 * `<cwd>/.validation-traces`. Without active cleanup the directory grows
 * indefinitely and eventually exhausts container disk. We delete files
 * older than this age and null out any `validation_runs.traceRef` rows
 * that point at deleted trace zips so the UI doesn't offer a download
 * link to a file that no longer exists.
 *
 * The default cutoff is 7 days, but admins can override it via the
 * Settings UI; the configured value is read fresh on every sweep so a
 * change takes effect on the next interval without a restart.
 */
export const VALIDATION_TRACE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** How often the in-process cleanup job re-runs after the first sweep. */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface ValidationTraceCleanupOptions {
  /** Override the directory to scan (defaults to `<cwd>/.validation-traces`). */
  dir?: string;
  /** Override the max-age cutoff (defaults to {@link VALIDATION_TRACE_MAX_AGE_MS}). */
  maxAgeMs?: number;
  /** Override "now" — used by tests to simulate the passage of time. */
  now?: number;
}

export interface ValidationTraceCleanupResult {
  filesDeleted: number;
  rowsCleared: number;
}

export interface ValidationTraceLastRun extends ValidationTraceCleanupResult {
  /** When the sweep finished, in ms since epoch. */
  finishedAt: number;
}

export interface ValidationTraceDirStats {
  /** Absolute path of the directory inspected. */
  dir: string;
  /** Total number of regular files in the directory (top-level only). */
  fileCount: number;
  /** Sum of file sizes in bytes. */
  totalBytes: number;
}

let lastRun: ValidationTraceLastRun | null = null;

/** Return the most recent in-process cleanup result, if any. */
export function getLastValidationTraceCleanupRun(): ValidationTraceLastRun | null {
  return lastRun;
}

/** Test-only: clear the cached last-run record. */
export function resetLastValidationTraceCleanupRun(): void {
  lastRun = null;
}

/**
 * Inspect the validation-traces directory and report total disk usage and
 * file count. A missing directory is reported as zero — it just means no
 * validations have produced traces yet (or the cleanup swept the last
 * one). Sub-directories are not expected here, but if any are present
 * they are skipped (we only count regular files).
 */
export async function getValidationTraceDirStats(
  opts: { dir?: string } = {},
): Promise<ValidationTraceDirStats> {
  const dir = opts.dir ?? path.join(process.cwd(), ".validation-traces");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { dir, fileCount: 0, totalBytes: 0 };
    }
    throw err;
  }
  let fileCount = 0;
  let totalBytes = 0;
  for (const name of entries) {
    try {
      const stat = await fs.stat(path.join(dir, name));
      if (!stat.isFile()) continue;
      fileCount++;
      totalBytes += stat.size;
    } catch {
      // Race with the cleanup sweep — file vanished between readdir and
      // stat. Ignore and keep counting the rest.
    }
  }
  return { dir, fileCount, totalBytes };
}

/**
 * Sweep the validation-traces directory once. Files older than the
 * configured max age are unlinked; for any deleted `<runId>.zip`
 * trace the matching `validation_runs.traceRef` is nulled so the API
 * no longer claims a downloadable trace exists.
 *
 * Safe to invoke concurrently with running validations: a freshly
 * written file will have a current mtime and so will be skipped.
 */
export async function runValidationTraceCleanup(
  opts: ValidationTraceCleanupOptions = {},
): Promise<ValidationTraceCleanupResult> {
  const dir = opts.dir ?? path.join(process.cwd(), ".validation-traces");
  // Resolve the cutoff from the user-configured retention window (in days)
  // unless the caller supplied an explicit override (used by tests).
  const maxAgeMs =
    opts.maxAgeMs ??
    (await getValidationTraceRetentionDays()) * 24 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const cutoff = now - maxAgeMs;

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { filesDeleted: 0, rowsCleared: 0 };
    }
    throw err;
  }

  const deletedTraceNames: string[] = [];
  let filesDeleted = 0;
  for (const name of entries) {
    const full = path.join(dir, name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.mtimeMs >= cutoff) continue;
    try {
      await fs.unlink(full);
      filesDeleted++;
      // traceRef stores the basename of the zip — track those so the
      // DB cleanup below can null them in a single UPDATE.
      if (name.endsWith(".zip")) deletedTraceNames.push(name);
    } catch (err) {
      logger.warn(
        { err, file: full },
        "validation trace cleanup: failed to delete file",
      );
    }
  }

  let rowsCleared = 0;
  if (deletedTraceNames.length > 0) {
    const updated = await db
      .update(validationRunsTable)
      .set({ traceRef: null })
      .where(inArray(validationRunsTable.traceRef, deletedTraceNames))
      .returning({ id: validationRunsTable.id });
    rowsCleared = updated.length;
  }

  return { filesDeleted, rowsCleared };
}

let scheduleHandle: NodeJS.Timeout | null = null;

/**
 * Start the in-process cleanup schedule: runs once immediately and then
 * every {@link CLEANUP_INTERVAL_MS}. The interval is unref'd so it does
 * not keep the event loop alive on shutdown. Calling more than once is
 * a no-op.
 */
export function startValidationTraceCleanupSchedule(): void {
  if (scheduleHandle) return;
  const sweep = () => {
    runValidationTraceCleanup().then(
      (result) => {
        lastRun = { ...result, finishedAt: Date.now() };
        logger.info(
          { ...result },
          "validation trace cleanup completed",
        );
      },
      (err) =>
        logger.error(
          { err },
          "validation trace cleanup failed",
        ),
    );
  };
  sweep();
  scheduleHandle = setInterval(sweep, CLEANUP_INTERVAL_MS);
  scheduleHandle.unref();
}

/** Stop the schedule (intended for tests / graceful shutdown). */
export function stopValidationTraceCleanupSchedule(): void {
  if (scheduleHandle) {
    clearInterval(scheduleHandle);
    scheduleHandle = null;
  }
}

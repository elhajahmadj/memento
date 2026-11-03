import fs from "node:fs/promises";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";

/**
 * Default retention cap for `.bak` snapshots written when a hook body is
 * overwritten by a recording. Used when the user has not customised it via
 * Settings, and as the fallback when the settings file is missing or
 * malformed.
 */
export const DEFAULT_HOOK_BACKUP_RETENTION = 5;

/** Inclusive bounds for a user-supplied hook backup retention value. */
export const HOOK_BACKUP_RETENTION_MIN = 1;
export const HOOK_BACKUP_RETENTION_MAX = 100;

/**
 * Default retention window (in days) for validation trace artifacts under
 * `<cwd>/.validation-traces`. Used when the user has not customised it via
 * Settings and as the fallback when the settings file is missing or
 * malformed.
 */
export const DEFAULT_VALIDATION_TRACE_RETENTION_DAYS = 7;

/** Inclusive bounds for a user-supplied validation trace retention (days). */
export const VALIDATION_TRACE_RETENTION_MIN = 1;
export const VALIDATION_TRACE_RETENTION_MAX = 365;

const SETTINGS_FILE = ".testbuilder-settings.json";

interface WorkspaceSettings {
  hookBackupRetention?: number;
  validationTraceRetentionDays?: number;
}

function settingsPath(): string {
  return path.join(recorderConfig.workspaceDir, SETTINGS_FILE);
}

async function readWorkspaceSettings(): Promise<WorkspaceSettings> {
  try {
    const txt = await fs.readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(txt);
    if (parsed && typeof parsed === "object") {
      return parsed as WorkspaceSettings;
    }
  } catch {
    // Missing or malformed settings file — fall through to defaults.
  }
  return {};
}

async function writeWorkspaceSettings(s: WorkspaceSettings): Promise<void> {
  await fs.mkdir(recorderConfig.workspaceDir, { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(s, null, 2));
}

function clampRetention(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_HOOK_BACKUP_RETENTION;
  const i = Math.trunc(n);
  if (i < HOOK_BACKUP_RETENTION_MIN) return HOOK_BACKUP_RETENTION_MIN;
  if (i > HOOK_BACKUP_RETENTION_MAX) return HOOK_BACKUP_RETENTION_MAX;
  return i;
}

/**
 * Returns the configured per-(test class, hook) backup retention count, or
 * `DEFAULT_HOOK_BACKUP_RETENTION` when the user has not set one. A malformed
 * or out-of-range stored value is silently coerced into the supported range
 * so the pruner can never throw on a typo'd settings file.
 */
export async function getHookBackupRetention(): Promise<number> {
  const settings = await readWorkspaceSettings();
  if (typeof settings.hookBackupRetention !== "number") {
    return DEFAULT_HOOK_BACKUP_RETENTION;
  }
  return clampRetention(settings.hookBackupRetention);
}

/**
 * Persist a new hook backup retention value. The input is validated and
 * clamped into `[HOOK_BACKUP_RETENTION_MIN, HOOK_BACKUP_RETENTION_MAX]`;
 * the stored (clamped) value is returned so callers can echo it back to
 * the UI.
 */
export async function setHookBackupRetention(n: number): Promise<number> {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error("Retention must be an integer");
  }
  if (n < HOOK_BACKUP_RETENTION_MIN || n > HOOK_BACKUP_RETENTION_MAX) {
    throw new Error(
      `Retention must be between ${HOOK_BACKUP_RETENTION_MIN} and ${HOOK_BACKUP_RETENTION_MAX}`,
    );
  }
  const current = await readWorkspaceSettings();
  const next: WorkspaceSettings = { ...current, hookBackupRetention: n };
  await writeWorkspaceSettings(next);
  return n;
}

function clampTraceRetention(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_VALIDATION_TRACE_RETENTION_DAYS;
  const i = Math.trunc(n);
  if (i < VALIDATION_TRACE_RETENTION_MIN) return VALIDATION_TRACE_RETENTION_MIN;
  if (i > VALIDATION_TRACE_RETENTION_MAX) return VALIDATION_TRACE_RETENTION_MAX;
  return i;
}

/**
 * Returns the configured validation trace retention window in days, or
 * `DEFAULT_VALIDATION_TRACE_RETENTION_DAYS` when the user has not set one.
 * A malformed or out-of-range stored value is silently coerced into the
 * supported range so the cleanup job can never throw on a typo'd settings
 * file.
 */
export async function getValidationTraceRetentionDays(): Promise<number> {
  const settings = await readWorkspaceSettings();
  if (typeof settings.validationTraceRetentionDays !== "number") {
    return DEFAULT_VALIDATION_TRACE_RETENTION_DAYS;
  }
  return clampTraceRetention(settings.validationTraceRetentionDays);
}

/**
 * Persist a new validation trace retention value (in days). The input is
 * validated and required to fall within
 * `[VALIDATION_TRACE_RETENTION_MIN, VALIDATION_TRACE_RETENTION_MAX]`; the
 * stored value is returned so callers can echo it back to the UI.
 */
export async function setValidationTraceRetentionDays(
  n: number,
): Promise<number> {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error("Retention must be an integer");
  }
  if (
    n < VALIDATION_TRACE_RETENTION_MIN ||
    n > VALIDATION_TRACE_RETENTION_MAX
  ) {
    throw new Error(
      `Retention must be between ${VALIDATION_TRACE_RETENTION_MIN} and ${VALIDATION_TRACE_RETENTION_MAX}`,
    );
  }
  const current = await readWorkspaceSettings();
  const next: WorkspaceSettings = {
    ...current,
    validationTraceRetentionDays: n,
  };
  await writeWorkspaceSettings(next);
  return n;
}

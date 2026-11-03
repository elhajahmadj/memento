export type ValidateRetentionResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Pure validation shared by the "hook backup retention" (1–100) and
 * "validation trace retention" (1–365 days) inputs in Settings. The
 * caller picks the bounds and the empty-state message.
 */
export function validateRetention(
  raw: string,
  min: number,
  max: number,
): ValidateRetentionResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: `Enter a number between ${min} and ${max}` };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: "Enter a whole number" };
  }
  if (n < min || n > max) {
    return { ok: false, error: `Must be between ${min} and ${max}` };
  }
  return { ok: true, value: n };
}

export const HOOK_BACKUP_RETENTION_BOUNDS = { min: 1, max: 100 } as const;
export const VALIDATION_TRACE_RETENTION_BOUNDS = { min: 1, max: 365 } as const;

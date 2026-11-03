export type ParseSharedStepActionsResult =
  | { ok: true; value: unknown[] }
  | { ok: false; error: string };

/**
 * Pure validation for the Settings → Shared steps "Actions (JSON)"
 * textarea. Must parse as a non-empty JSON array.
 */
export function parseSharedStepActions(
  raw: string,
): ParseSharedStepActionsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Actions JSON is not valid JSON." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, error: "Actions must be a non-empty JSON array." };
  }
  return { ok: true, value: parsed };
}

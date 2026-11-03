/**
 * Pure approval-state transition rules. No I/O, no DB. Each rule
 * returns a `Result` so use cases can pipe failures straight through to
 * the presentation layer without `throw`.
 */
import {
  conflictError,
  validationError,
  type ConflictError,
  type ValidationError,
} from "@workspace/kernel/errors";
import { err, ok, type Result } from "@workspace/kernel/result";
import type { ApprovalStatus } from "@workspace/db";

/** A submission can only be approved/rejected once. */
export function ensurePending(
  status: ApprovalStatus,
): Result<void, ConflictError> {
  if (status !== "pending") {
    return err(conflictError("Submission has already been decided"));
  }
  return ok(undefined);
}

/** A fork must be active to submit it for approval. */
export function ensureForkActive(
  forkStatus: string,
): Result<void, ValidationError> {
  if (forkStatus !== "active") {
    return err(validationError("Fork must be active to submit for approval"));
  }
  return ok(undefined);
}

/**
 * Validate the caller's optional `selectedFiles` list against the diff.
 * Returns the resolved set to apply (undefined => "all changed files").
 */
export function resolveSelectedFiles(
  requested: ReadonlyArray<string> | undefined,
  changed: ReadonlySet<string>,
): Result<ReadonlySet<string> | undefined, ValidationError> {
  if (requested === undefined) return ok(undefined);
  if (requested.length === 0) {
    return err(
      validationError(
        "selectedFiles was provided but empty; refusing to approve nothing.",
      ),
    );
  }
  const out = new Set<string>();
  for (const p of requested) {
    if (!changed.has(p)) {
      return err(validationError(`Selected file not in diff: ${p}`));
    }
    out.add(p);
  }
  return ok(out);
}

/**
 * If any file the caller is about to apply still has a conflict marker
 * (main changed since snapshot), the caller must explicitly acknowledge
 * before we'll overwrite their changes.
 */
export function ensureConflictsAcknowledged(
  conflictCount: number,
  acknowledged: boolean | undefined,
): Result<void, ConflictError> {
  if (conflictCount > 0 && !acknowledged) {
    return err(
      conflictError(
        `Refusing to approve: ${conflictCount} file(s) have changed in main since this submission was created. Acknowledge conflicts to proceed.`,
      ),
    );
  }
  return ok(undefined);
}

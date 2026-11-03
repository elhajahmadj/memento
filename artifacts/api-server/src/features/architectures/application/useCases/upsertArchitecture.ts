/**
 * Create or update a custom architecture. Built-in ids are rejected
 * with a `validation` error so callers can't shadow the canonical
 * built-ins.
 *
 * When the caller supplies an empty id, a fresh UUID is generated.
 * Caller-supplied ids must pass `assertSafeArchId` (enforced inside the
 * repository's `save`) so the persisted filename cannot escape the
 * `.architectures` directory.
 */
import {
  type AppError,
  type Result,
  err,
  infrastructureError,
  ok,
  validationError,
} from "@workspace/kernel";

import { isBuiltInId } from "../../domain/builtIns";
import type { Architecture } from "../../domain/types";
import { newArchitectureId, validateArchitecture } from "../../domain/validation";
import type { ArchitectureRepository } from "../../domain/ports/architectureRepository";

export interface UpsertArchitectureUseCase {
  execute(arch: Architecture): Promise<Result<Architecture, AppError>>;
}

export function makeUpsertArchitectureUseCase(
  repo: ArchitectureRepository,
): UpsertArchitectureUseCase {
  return {
    async execute(arch) {
      if (isBuiltInId(arch.id)) {
        return err(validationError("Built-in architectures cannot be modified"));
      }
      try {
        validateArchitecture(arch);
      } catch (e) {
        return err(validationError((e as Error).message));
      }
      const id = arch.id ? arch.id : newArchitectureId();
      try {
        const saved = await repo.save({ ...arch, id });
        return ok(saved);
      } catch (e) {
        // Path-traversal / unsafe-id rejections surface as validation
        // errors so HTTP callers get a 400 rather than a 502.
        const message = (e as Error).message;
        if (/architecture id|escapes architectures/i.test(message)) {
          return err(validationError(message));
        }
        return err(infrastructureError("Failed to save architecture", e));
      }
    },
  };
}

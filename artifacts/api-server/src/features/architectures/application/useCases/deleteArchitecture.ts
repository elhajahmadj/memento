/**
 * Delete a custom architecture by id. Built-in ids are rejected with a
 * `validation` error. Missing rows are a no-op (idempotent).
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
import type { ArchitectureRepository } from "../../domain/ports/architectureRepository";

export interface DeleteArchitectureUseCase {
  execute(id: string): Promise<Result<void, AppError>>;
}

export function makeDeleteArchitectureUseCase(
  repo: ArchitectureRepository,
): DeleteArchitectureUseCase {
  return {
    async execute(id) {
      if (isBuiltInId(id)) {
        return err(validationError("Built-in architectures cannot be deleted"));
      }
      try {
        await repo.delete(id);
        return ok(undefined);
      } catch (e) {
        const message = (e as Error).message;
        if (/architecture id|escapes architectures/i.test(message)) {
          return err(validationError(message));
        }
        return err(infrastructureError("Failed to delete architecture", e));
      }
    },
  };
}

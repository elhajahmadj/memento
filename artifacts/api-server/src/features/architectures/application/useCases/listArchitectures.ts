/**
 * List all architectures (built-in + custom). Returns built-ins first
 * in their canonical order, then custom architectures sorted by name.
 */
import {
  type AppError,
  type Result,
  err,
  infrastructureError,
  ok,
} from "@workspace/kernel";

import { BUILTIN_ARCHITECTURES } from "../../domain/builtIns";
import type { Architecture } from "../../domain/types";
import type { ArchitectureRepository } from "../../domain/ports/architectureRepository";

export interface ListArchitecturesUseCase {
  execute(): Promise<Result<Architecture[], AppError>>;
}

export function makeListArchitecturesUseCase(
  repo: ArchitectureRepository,
): ListArchitecturesUseCase {
  return {
    async execute() {
      try {
        const custom = await repo.list();
        return ok([...BUILTIN_ARCHITECTURES, ...custom]);
      } catch (e) {
        return err(
          infrastructureError("Failed to list architectures", e),
        );
      }
    },
  };
}

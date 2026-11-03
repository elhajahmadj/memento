/**
 * Look up a single architecture by id. Built-in architectures resolve
 * from the in-memory registry; everything else goes through the
 * persistence port.
 */
import {
  type AppError,
  type Result,
  err,
  infrastructureError,
  notFoundError,
  ok,
} from "@workspace/kernel";

import { findBuiltInById } from "../../domain/builtIns";
import type { Architecture } from "../../domain/types";
import type { ArchitectureRepository } from "../../domain/ports/architectureRepository";

export interface GetArchitectureUseCase {
  execute(id: string): Promise<Result<Architecture, AppError>>;
}

export function makeGetArchitectureUseCase(
  repo: ArchitectureRepository,
): GetArchitectureUseCase {
  return {
    async execute(id) {
      const builtIn = findBuiltInById(id);
      if (builtIn) return ok(builtIn);
      try {
        const custom = await repo.findById(id);
        if (!custom) return err(notFoundError("Architecture", id));
        return ok(custom);
      } catch (e) {
        return err(infrastructureError("Failed to load architecture", e));
      }
    },
  };
}

/**
 * test-builder composition root.
 *
 * This module is the single place where infrastructure adapters
 * (orval-generated react-query hooks, fetch-based repositories) are
 * wired into application use cases. Components consume the container
 * via `AppProviders` -> React context -> `useContainer()` /
 * `useUseCase()` helpers.
 *
 * Features migrate into this container one at a time. Today: codegen
 * (NormalizeNounUseCase). Future: auth, projects, workbench, settings,
 * tools, approvals.
 */
import { NormalizeNounUseCase } from "@/features/codegen";

export interface Container {
  readonly useCases: {
    readonly normalizeNoun: NormalizeNounUseCase;
  };
}

/**
 * Build the production container. Called once from
 * `AppProviders` at app boot.
 */
export function buildContainer(): Container {
  return {
    useCases: {
      normalizeNoun: new NormalizeNounUseCase(),
    },
  };
}

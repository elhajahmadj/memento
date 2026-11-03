/**
 * Composition root + domain re-exports for the architectures feature.
 *
 * The original 3,200-line `architectureService.ts` was split into Clean
 * Architecture layers:
 *
 *   - `domain/`               — pure types, schemas, validation, ports,
 *                               and the per-language built-in registries.
 *   - `application/useCases/` — `Result<T, AppError>`-returning use cases.
 *   - `infrastructure/repositories/filesystemArchitectureRepository.ts`
 *                             — filesystem adapter that implements the
 *                               `ArchitectureRepository` port.
 *
 * This module now does two things only:
 *   1. Re-exports domain types, schemas, IDs, and per-language template
 *      constants so unchanged callers (codegen, scaffolders, etc.) keep
 *      their existing import paths.
 *   2. Constructs the production use cases once against the filesystem
 *      repository and exposes them via `architecturesComposition`, which
 *      `composition/container.ts` wires into the request-scoped container.
 *
 * The previous throw-on-error wrappers (`listArchitectures`,
 * `getArchitecture`, `upsertArchitecture`, `deleteArchitecture`) have been
 * removed — callers depend on the use cases directly via the container.
 */

import { newArchitectureId as _newArchitectureId } from "../domain/validation";
import { FilesystemArchitectureRepository } from "./repositories/filesystemArchitectureRepository";
import { makeListArchitecturesUseCase } from "../application/useCases/listArchitectures";
import { makeGetArchitectureUseCase } from "../application/useCases/getArchitecture";
import { makeUpsertArchitectureUseCase } from "../application/useCases/upsertArchitecture";
import { makeDeleteArchitectureUseCase } from "../application/useCases/deleteArchitecture";

// -- Re-exports: domain types, schemas, IDs, and built-in helpers ----

export type {
  ArchFile,
  ArchFolder,
  ArchProject,
  Architecture,
  Language,
  ArchSolutionType,
} from "../domain/types";

export {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  DEFAULT_ARCH_SOLUTION_TYPE,
  normalizeArchSolutionType,
  DEFAULT_ARCHITECTURE_ID,
  PYTHON_DEFAULT_ARCHITECTURE_ID,
  NODEJS_DEFAULT_ARCHITECTURE_ID,
  JAVA_DEFAULT_ARCHITECTURE_ID,
  API_DEFAULT_CSHARP_ARCHITECTURE_ID,
  API_DEFAULT_PYTHON_ARCHITECTURE_ID,
  API_DEFAULT_NODEJS_ARCHITECTURE_ID,
  API_DEFAULT_JAVA_ARCHITECTURE_ID,
  BUILTIN_API_ARCHITECTURE_IDS,
  isBuiltInApiArchitectureId,
  builtInApiArchitectureIdFor,
} from "../domain/types";

export {
  ArchFileSchema,
  ArchFolderSchema,
  ArchProjectSchema,
  LanguageSchema,
  ArchSolutionTypeSchema,
  ArchitectureSchema,
} from "../domain/schemas";

export {
  architectureLanguage,
  architectureSolutionType,
} from "../domain/validation";

export {
  getDefaultArchitecture,
  getPythonDefaultArchitecture,
  getNodejsDefaultArchitecture,
  getJavaDefaultArchitecture,
} from "../domain/builtIns";

// Per-language template re-exports used by the codegen modules.
export { PYTHON_TEST_CONFIG_CONTENT } from "../domain/builtIns/python";
export { NODEJS_TEST_CONFIG_CONTENT } from "../domain/builtIns/nodejs";
export { JAVA_TEST_CONFIG_CONTENT } from "../domain/builtIns/java";

export const newArchitectureId = _newArchitectureId;

// -- Composition root for the architectures feature ------------------
//
// Construct the production use cases once at module load and expose
// them via `architecturesComposition` for `composition/container.ts`.
// New code should depend on the use cases through the container.

const repo = new FilesystemArchitectureRepository();

export const architecturesComposition = {
  list: makeListArchitecturesUseCase(repo),
  get: makeGetArchitectureUseCase(repo),
  upsert: makeUpsertArchitectureUseCase(repo),
  delete: makeDeleteArchitectureUseCase(repo),
} as const;

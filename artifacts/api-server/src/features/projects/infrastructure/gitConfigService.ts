/**
 * Thin barrel that preserves the historical
 * `@/features/projects/infrastructure/gitConfigService` import path
 * after the module was split into focused files.
 *
 * Concrete implementations now live in:
 *  - `./git/*` — provider port + adapters (Azure / GitHub), git CLI
 *    runner, error classifier, fs helpers, working-copy helpers
 *  - `./gitConfigRepository` — DB reads (`getGitConfig`,
 *    `loadLinkedPat`, `findProjectsBoundToRepoPat`,
 *    `resolvePatForRow`, `assertEncryptionKeyOnBoot`)
 *  - `../application/useCases/gitConfig/*` — use cases
 *    (`upsertGitConfig`, `cloneProjectFromRepo`, `pullProject`,
 *    `pushProject`, branch operations)
 */

// Provider port + helpers.
export {
  type GitProvider,
  SUPPORTED_PROVIDERS,
  PROJECT_MARKER_FILE,
  isGitProvider,
  normalizeProvider,
} from "./git/gitProvider";
export {
  validateAzureRepoUrl,
  validateGitHubRepoUrl,
  validateRepoUrl,
  injectPatIntoUrl,
  getProviderAdapter,
} from "./git/gitProviderRegistry";
export { redactPatFromGitOutput } from "./git/gitCli";
export {
  classifyGitError,
  classifyPushError,
} from "./git/gitErrorClassifier";
export { copyTreeInto, clearDirExcept } from "./git/fsHelpers";
export {
  readCurrentBranch,
  validateBranchName,
} from "./git/gitWorkingCopy";

// Repository.
export {
  type PublicGitConfig,
  getGitConfig,
  findProjectsBoundToRepoPat,
  assertEncryptionKeyOnBoot,
} from "./gitConfigRepository";

// Use cases.
export {
  upsertGitConfig,
  type UpsertGitConfigInput as UpsertInput,
} from "@/features/projects/application/useCases/gitConfig/upsertGitConfig";
export {
  cloneProjectFromRepo,
  type CloneInput,
  type CloneResult,
  type CloneSuccessResult,
  type CloneErrorResult,
  type CloneErrorCode,
} from "@/features/projects/application/useCases/gitConfig/cloneProjectFromRepo";
export {
  pullProject,
  type PullResult,
  type PullSuccessResult,
  type PullErrorResult,
  type PullErrorCode,
} from "@/features/projects/application/useCases/gitConfig/pullProject";
export {
  pushProject,
  type PushResult,
  type PushSuccessResult,
  type PushErrorResult,
  type PushErrorCode,
} from "@/features/projects/application/useCases/gitConfig/pushProject";
export {
  listBranches,
  createBranch,
  checkoutBranch,
  type BranchListResult,
  type BranchOpResult,
  type BranchOpSuccess,
  type BranchOpError,
  type BranchOpErrorCode,
} from "@/features/projects/application/useCases/gitConfig/branchOperations";

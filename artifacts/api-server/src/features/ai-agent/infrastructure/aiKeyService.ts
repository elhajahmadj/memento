// Barrel re-exporting the AI key library service surface. The
// implementation lives in focused modules (`aiKeyTypes`,
// `aiKeyValidation`, `aiKeyCrud`, `aiKeyDefault`, `aiKeyDelete`,
// `aiKeyResolver`, `aiKeyHealth`, `aiKeyBackfill`); this file
// preserves the original import path used by route handlers and
// other callers.
export {
  AiKeyServiceError,
  type CreateAiKeyInput,
  type PublicAiKey,
  type ResolvedAiKey,
  type UpdateAiKeyInput,
} from "./aiKeyTypes";
export { createAiKey, getAiKey, listAiKeys, updateAiKey } from "./aiKeyCrud";
export { setDefaultAiKey } from "./aiKeyDefault";
export { deleteAiKey, findProjectsBoundToAiKey } from "./aiKeyDelete";
export { resolveActiveKey } from "./aiKeyResolver";
export { checkAiKeyHealth } from "./aiKeyHealth";
export { backfillLegacyOrgKeysOnBoot } from "./aiKeyBackfill";

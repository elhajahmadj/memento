/**
 * Backwards-compatibility barrel re-exporting the Node.js codegen
 * surface. The implementation now lives split per section under
 * `./languages/nodejs/` (one file per section, each <=300 lines).
 *
 * Existing callers and tests continue to import from
 * `@/features/codegen/infrastructure/nodejsCodegen`; new code should
 * import directly from `./languages/nodejs` or its submodules.
 */
export * from "./languages/nodejs";

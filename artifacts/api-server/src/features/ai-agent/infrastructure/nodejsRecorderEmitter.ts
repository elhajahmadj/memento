/**
 * Backwards-compatibility barrel re-exporting the Node.js recorder
 * emitter. The implementation now lives split per section under
 * `@/features/codegen/infrastructure/languages/nodejs/recorder/`
 * (one file per section, each <=300 lines).
 */
export * from "@/features/codegen/infrastructure/languages/nodejs/recorder";

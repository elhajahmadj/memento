/**
 * Backwards-compatibility barrel re-exporting the Node.js API codegen
 * surface. The implementation now lives split per section under
 * `./languages/nodejs/api/` (one file per section, each <=300 lines).
 */
export * from "./languages/nodejs/api";

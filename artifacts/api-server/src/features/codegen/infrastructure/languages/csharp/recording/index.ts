/**
 * Barrel for the per-section recording-time C# codegen modules
 * (task #83 split of the historical `csharpCodegen.ts` monolith).
 * Consumers should keep importing from
 * `@/features/codegen/infrastructure/csharpCodegen` (the thin barrel
 * over this one); this file is the internal composition point so
 * `csharpCodegenAdapter` and the section-parity tests can pick up the
 * function identities by name without going through the legacy path.
 */
export * from "./codeMask";
export * from "./identifiers";
export * from "./naming";
export * from "./testSuiteClass";
export * from "./hookBackups";
export * from "./hooks";
export * from "./testMethods";
export * from "./pageObject";
export * from "./assertions";
export * from "./constants";
export * from "./macros";
export * from "./testConfig";
export * from "./suiteFiles";
export * from "./livePreview";

/**
 * Recording-time C# codegen barrel (task #83 split).
 *
 * The historical ~3.1k-line monolith was broken up into per-section
 * modules under `./languages/csharp/recording/`. This file remains the
 * canonical public entry point so existing callers (the recording
 * service, the per-language adapter, the legacy `./codegen` shim, and
 * the section-parity tests) keep compiling unchanged — every former
 * export is re-exported verbatim from its new module home, preserving
 * function identity so `recordingCodegen.X === adapter.X` parity tests
 * still pass.
 *
 * See `./languages/csharp/recording/index.ts` for the section breakdown
 * and `docs/REFACTORING_PLAN.md` for the rationale.
 */

// Cross-language codegen types still live in `./domain/types`; they are
// re-exported here so historical callers importing them from this file
// (or via the `./codegen` shim) keep compiling.
export type {
  AssertionKind,
  ApiMethod,
  WaitKind,
  RecordedAction,
  HookKind,
  ReplaceHookBodyResult,
  AddTestMethodResult,
  AddTestMethodOptions,
  SuiteFiles,
  SuiteGenerationResult,
} from "../domain/types";

export * from "./languages/csharp/recording";

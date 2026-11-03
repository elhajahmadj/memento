/**
 * Barrel re-export shim for the C# "Build API Test" codegen surface.
 *
 * The implementation was split (task #36) out of this 1k+ line module
 * into focused per-section emitters under
 * `infrastructure/languages/csharp/api/`. This file preserves the
 * historical import path (`@/features/codegen/infrastructure/apiCsharpCodegen`)
 * so existing call sites and tests keep compiling unchanged while new
 * code can target the per-section modules directly.
 */
export * from "./languages/csharp/api";

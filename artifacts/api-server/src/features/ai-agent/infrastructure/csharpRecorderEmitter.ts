/**
 * Barrel re-export shim for the C# AI-Agent recorder emitter.
 *
 * The implementation was split (task #36) out of this 1k+ line module
 * into focused per-section emitters under
 * `features/codegen/infrastructure/languages/csharp/recorder/`. This
 * file preserves the historical import path so the materializer and
 * the existing recorder tests keep compiling unchanged while new code
 * can target the per-section modules directly.
 */
export { emitCsharp, type EmitOptions } from "@/features/codegen/infrastructure/languages/csharp/recorder";

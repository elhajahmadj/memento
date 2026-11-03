/**
 * Barrel exports for the C# recorder-side emitter section modules.
 * Mirrors the public surface of the legacy
 * `features/ai-agent/infrastructure/csharpRecorderEmitter.ts` module
 * so the materializer / tests keep compiling unchanged.
 */
export { emitCsharp, type EmitOptions } from "./emit";

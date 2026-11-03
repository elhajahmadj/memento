/**
 * Thin barrel re-export. The implementation lives in per-section
 * modules under `@/features/codegen/infrastructure/languages/python/recorder`
 * (see task #81). This file is kept so existing imports
 * (`./pythonRecorderEmitter` from `materializer.ts` and tests) keep
 * working without churn.
 */
export {
  emitPython,
  type PyEmitOptions,
} from "@/features/codegen/infrastructure/languages/python/recorder";

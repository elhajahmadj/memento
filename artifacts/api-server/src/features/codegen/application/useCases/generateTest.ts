/**
 * Language-agnostic codegen orchestrator.
 *
 * Picks the per-language emitter via `codegenAdapter.generateSuiteFiles`
 * (the existing dispatch point) and wraps the result in `Result<T, E>`
 * so call sites can reason about failure uniformly. This is a thin
 * orchestrator on top of the adapter — the actual file-emission logic
 * still lives in the per-language modules (`csharpCodegen.ts`,
 * `pythonCodegen.ts`, `nodejsCodegen.ts`, `javaCodegen.ts`), which a
 * downstream task will further split into per-section modules.
 *
 * Behavior is unchanged from calling `codegenAdapter.generateSuiteFiles`
 * directly; this module only standardizes error handling and provides a
 * stable entry point for the composition root to register against.
 */
import {
  err,
  ok,
  infrastructureError,
  type AppError,
  type Result,
} from "@workspace/kernel";
import { generateSuiteFiles } from "@/features/codegen/infrastructure/codegenAdapter";
import type { Project } from "@/features/projects/domain/types";
import type {
  RecordedAction,
  SuiteGenerationResult,
} from "@/features/codegen/domain/types";

export interface GenerateTestInput {
  project: Project;
  suiteName: string;
  actions: RecordedAction[];
}

export type GeneratedTest = SuiteGenerationResult;

/**
 * Execute the per-language emitter for the supplied project and return
 * the generated suite paths. Any thrown error from the underlying
 * adapter is captured as `AppError.internal` so callers do not have to
 * `try/catch` the orchestrator themselves.
 */
export async function generateTest(
  input: GenerateTestInput,
): Promise<Result<GeneratedTest, AppError>> {
  try {
    const out = await generateSuiteFiles(
      input.project,
      input.suiteName,
      input.actions,
    );
    return ok(out);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(infrastructureError(`codegen failed: ${message}`, e));
  }
}

export type GenerateTestUseCase = typeof generateTest;

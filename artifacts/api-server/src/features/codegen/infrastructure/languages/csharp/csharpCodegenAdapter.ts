/**
 * Single composition root for the C# codegen surfaces (task #36).
 *
 * `apiCsharpCodegen.ts` and `csharpRecorderEmitter.ts` were previously
 * 1k+ line monoliths each. They are now split into focused per-section
 * modules under `api/` and `recorder/`; this adapter is the thin
 * facade that composes the section emitters and exposes both the
 * shared `LanguageCodegen` port (delegated to the existing
 * recording-driven test-class codegen in `csharpCodegen.ts`) and the
 * two additional surfaces named in task #36:
 *
 * - `planApiTestBuild` / `commitApiTestPlan` — the "Build API Test"
 *   flow that scaffolds endpoint constants, helper methods, assistant
 *   files, and the test class (was `apiCsharpCodegen.ts`).
 * - `emitCsharpRecorder` — the AI-Agent recorder that materializes an
 *   `AiRunReport` as a per-section C# tree (was
 *   `csharpRecorderEmitter.ts`).
 *
 * The `LanguageCodegen` surface is implemented by composition —
 * delegating to the function exports already on `csharpCodegen.ts`
 * — rather than re-implementing them here. Following task #83,
 * `csharpCodegen.ts` is itself a thin barrel over the per-section
 * modules in `./recording/`; composing instead of duplicating keeps
 * behavior byte-identical and avoids forking the recording-driven
 * codegen.
 */
import type { LanguageCodegen } from "@/features/codegen/domain/ports/LanguageCodegen";
import * as recordingCodegen from "@/features/codegen/infrastructure/csharpCodegen";
import {
  commitApiTestPlan,
  planApiTestBuild,
  type BuildApiTestPlan,
  type BuildApiTestSpec,
  type ProjectLike,
} from "./api";
import { emitCsharp, type EmitOptions } from "./recorder";

export interface CSharpCodegenAdapter extends LanguageCodegen {
  /** Plan the four file writes for a Build Test invocation. */
  planApiTestBuild(
    project: ProjectLike,
    spec: BuildApiTestSpec,
  ): Promise<BuildApiTestPlan>;
  /** Atomically commit a planned build to disk. */
  commitApiTestPlan(plan: BuildApiTestPlan): Promise<void>;
  /** Materialize an AI run report as a per-section C# tree. */
  emitCsharpRecorder(opts: EmitOptions): Promise<string[]>;
}

export const csharpCodegenAdapter: CSharpCodegenAdapter = {
  // LanguageCodegen surface — delegate to the existing
  // recording-driven test-class codegen module.
  generateTestClass: recordingCodegen.generateTestClass,
  generateSuiteFiles: recordingCodegen.generateSuiteFiles,
  addTestMethod: recordingCodegen.addTestMethod,
  replaceHookBody: recordingCodegen.replaceHookBody,
  readHookBody: recordingCodegen.readHookBody,
  isHookDefaultStub: recordingCodegen.isHookDefaultStub,

  // Build API Test surface — task #36 split.
  planApiTestBuild,
  commitApiTestPlan,

  // AI-Agent recorder surface — task #36 split.
  emitCsharpRecorder: emitCsharp,
};

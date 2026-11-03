/**
 * Port describing the contract every per-language codegen emitter must
 * satisfy so the language-agnostic orchestrator
 * (`application/useCases/generateTest.ts`) can dispatch to the right
 * adapter without coupling to any one language's module shape.
 *
 * The adapters today (`csharpCodegen.ts`, `pythonCodegen.ts`,
 * `nodejsCodegen.ts`, `javaCodegen.ts`) all already expose these
 * functions; this port simply names the contract so future emitters
 * (or test doubles) have something concrete to implement.
 *
 * Only the small subset of the cross-language surface the orchestrator
 * itself dispatches on lives here. Per-language quoting/rendering
 * helpers consumed line-by-line by the recording service stay on
 * `codegenAdapter.ts` until that module is itself split.
 */
import type { Project } from "@/features/projects/domain/types";
import type {
  AddTestMethodOptions,
  AddTestMethodResult,
  HookKind,
  RecordedAction,
  ReplaceHookBodyResult,
  SuiteGenerationResult,
} from "@/features/codegen/domain/types";

export interface LanguageCodegen {
  /**
   * Emit the empty test-suite class file (suite shell + fixture
   * boilerplate) for the supplied language and return its
   * project-relative path.
   */
  generateTestClass(project: Project, className: string): Promise<string>;

  /**
   * Emit / refresh every file that belongs to a suite (selectors map,
   * page object, interfaces, actions, suite shell) for the supplied
   * recorded action list and return the per-file relative paths.
   */
  generateSuiteFiles(
    project: Project,
    suiteName: string,
    actions: RecordedAction[],
  ): Promise<SuiteGenerationResult>;

  /**
   * Add (or, with `overwrite: true`, replace) a single test method on
   * an existing suite file.
   */
  addTestMethod(
    project: Project,
    fileRelPath: string,
    methodName: string,
    bodyLines: string[],
    pageObjectsUsed: string[],
    options?: AddTestMethodOptions,
  ): Promise<AddTestMethodResult>;

  /** Replace the body of a hook (`beforeEach` / `oneTimeSetup`). */
  replaceHookBody(
    project: Project,
    fileRelPath: string,
    hook: HookKind,
    bodyLines: string[],
  ): Promise<ReplaceHookBodyResult>;

  /** Read a hook body verbatim, or `null` when the hook is absent. */
  readHookBody(
    project: Project,
    fileRelPath: string,
    hook: HookKind,
  ): Promise<string | null>;

  /** True when the hook still contains the scaffold's default stub. */
  isHookDefaultStub(
    project: Project,
    fileRelPath: string,
    hook: HookKind,
  ): Promise<boolean>;
}

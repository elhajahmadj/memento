import type { Project } from "@/features/projects/domain/types";
import type {
  AddTestMethodOptions,
  AddTestMethodResult,
  HookKind,
  RecordedAction,
  ReplaceHookBodyResult,
  SuiteGenerationResult,
} from "@/features/codegen/domain/types";
import type { LanguageCodegen } from "@/features/codegen/domain/ports/LanguageCodegen";
import { generateTestClass } from "./testClass";
import { generateSuiteFiles } from "./suiteFiles";
import { addTestMethod } from "./testMethod";
import { isHookDefaultStub, readHookBody, replaceHookBody } from "./hooks";

/**
 * Concrete `LanguageCodegen` adapter for Node.js (`@playwright/test` +
 * TypeScript) projects. Thin pass-through to the per-section modules.
 */
export const NodejsCodegenAdapter: LanguageCodegen = {
  generateTestClass(project: Project, className: string): Promise<string> {
    return generateTestClass(project, className);
  },
  generateSuiteFiles(
    project: Project,
    suiteName: string,
    actions: RecordedAction[],
  ): Promise<SuiteGenerationResult> {
    return generateSuiteFiles(project, suiteName, actions);
  },
  addTestMethod(
    project: Project,
    fileRelPath: string,
    methodName: string,
    bodyLines: string[],
    pageObjectsUsed: string[],
    options?: AddTestMethodOptions,
  ): Promise<AddTestMethodResult> {
    return addTestMethod(
      project,
      fileRelPath,
      methodName,
      bodyLines,
      pageObjectsUsed,
      options,
    );
  },
  replaceHookBody(
    project: Project,
    fileRelPath: string,
    hook: HookKind,
    bodyLines: string[],
  ): Promise<ReplaceHookBodyResult> {
    return replaceHookBody(project, fileRelPath, hook, bodyLines);
  },
  readHookBody(
    project: Project,
    fileRelPath: string,
    hook: HookKind,
  ): Promise<string | null> {
    return readHookBody(project, fileRelPath, hook);
  },
  isHookDefaultStub(
    project: Project,
    fileRelPath: string,
    hook: HookKind,
  ): Promise<boolean> {
    return isHookDefaultStub(project, fileRelPath, hook);
  },
};

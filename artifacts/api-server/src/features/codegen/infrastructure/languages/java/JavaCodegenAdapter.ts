/**
 * Concrete `LanguageCodegen` implementation that delegates to the
 * per-section Java emitter modules under this folder. Mirrors the
 * existing dispatch in `codegenAdapter.ts` but exposes a single
 * stable object the orchestrator can hold instead of `import * as java`.
 */
import type { Project } from "@/features/projects/domain/types";
import type { LanguageCodegen } from "@/features/codegen/domain/ports/LanguageCodegen";
import type {
  AddTestMethodOptions,
  AddTestMethodResult,
  HookKind,
  RecordedAction,
  ReplaceHookBodyResult,
  SuiteGenerationResult,
} from "@/features/codegen/domain/types";

import { generateTestClass } from "./testClassScaffold";
import { generateSuiteFiles } from "./suiteFiles";
import { addTestMethod } from "./testMethod";
import {
  readHookBody,
  isHookDefaultStub,
  replaceHookBody,
} from "./hookBody";

export const JavaCodegenAdapter: LanguageCodegen = {
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

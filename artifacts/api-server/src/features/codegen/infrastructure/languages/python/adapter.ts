/**
 * `LanguageCodegen` port implementation for Python. Pure delegation
 * to the per-section modules under `languages/python/`.
 */
import type { LanguageCodegen } from "@/features/codegen/domain/ports/LanguageCodegen";
import { generateTestClass } from "./testClass";
import { generateSuiteFiles } from "./suiteFiles";
import { addTestMethod } from "./testMethod";
import {
  isHookDefaultStub,
  readHookBody,
  replaceHookBody,
} from "./hooks";

export const PythonCodegenAdapter: LanguageCodegen = {
  generateTestClass,
  generateSuiteFiles,
  addTestMethod,
  replaceHookBody,
  readHookBody,
  isHookDefaultStub,
};

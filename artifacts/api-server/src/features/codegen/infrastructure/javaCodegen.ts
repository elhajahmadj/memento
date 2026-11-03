// Thin re-export barrel. Implementation has moved into per-section
// modules under `languages/java/` (task #39). Existing imports
// (`import * as java from "@/features/codegen/infrastructure/javaCodegen"`,
// named imports from tests, etc.) keep working unchanged.
export { toRelative } from "@/features/projects/infrastructure/paths";
export { toCamel, hookMethodNameJava, javaQuotedArg } from "./languages/java/naming";
export {
  suiteConstantsClassName,
  suiteTestCategoriesClassName,
  suiteConstantsRelPath,
  suiteTestCategoriesRelPath,
} from "./languages/java/paths";
export { generateTestClass } from "./languages/java/testClassScaffold";
export {
  readHookBody,
  isHookDefaultStub,
  replaceHookBody,
  type ReplaceHookBodyResult,
} from "./languages/java/hookBody";
export { checkTestMethodExists, addTestMethod } from "./languages/java/testMethod";
export {
  readSuiteActionsMethodNames,
  suggestNonCollidingName,
} from "./languages/java/suiteHelpers";
export { generateSuiteFiles } from "./languages/java/suiteFiles";
export {
  renderWaitLineJava,
  renderAssertionLineJava,
  renderRouteMockLineJava,
  renderApiAssertionLineJava,
} from "./languages/java/lineRendering";
export {
  readRecordedConstants,
  writeRecordedConstants,
  upsertTestCategoryConstantJava,
} from "./languages/java/recordedConstants";
export { regenerateTestConfig } from "./languages/java/testConfig";

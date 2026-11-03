/**
 * Barrel exports for the C# "Build API Test" codegen section emitters.
 * Mirrors the public surface of the legacy `apiCsharpCodegen.ts` module
 * so existing importers keep compiling unchanged.
 */
export type {
  ApiTestParameter,
  BuildApiTestPlan,
  BuildApiTestPlanFile,
  BuildApiTestSpec,
  BuildInto,
  DefaultHeader,
  HttpVerb,
  MultipartField,
  ProjectLike,
} from "./types";
export { HTTP_VERBS } from "./types";

export {
  apiSuiteConstantsClassName,
  apiSuiteTestCategoriesClassName,
  deriveApiSuiteStem,
  renderApiSuiteConstantsFile,
  upsertApiTestCategoryConstant,
} from "./naming";

export {
  renderEndpointConstant,
  upsertEndpointConstant,
} from "./endpointConstants";

export {
  assistantClassNameFor,
  renderHelperMethod,
  renderNewAssistantFile,
  upsertHelperMethod,
} from "./helperMethod";

export {
  insertFactIntoExistingClass,
  renderNewTestClass,
} from "./testClass";

export { mergeAppSettings } from "./appsettings";

export { commitApiTestPlan, planApiTestBuild } from "./buildPlan";

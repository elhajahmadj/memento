/**
 * No-op JMX codegen adapter.
 *
 * Implements just enough of the `LanguageCodegen` shape that the
 * codegen dispatcher (`codegenAdapter.ts`) and any per-language
 * registry can hold a value for `language === "jmx"`. JMX is an
 * emission-only target — there is no test-suite source tree to
 * generate / hook / mutate — so every operation either returns an
 * empty result or throws a clear "not applicable" error.
 *
 * The real `.jmx` XML emission lives in the dedicated "JMX XML
 * emitter & export modes" task and consumes `JmxHttpEvent` /
 * `JmxExportOptions` directly rather than going through this adapter.
 */
import type { LanguageCodegen } from "@/features/codegen/domain/ports/LanguageCodegen";

function notApplicable(op: string): never {
  throw new Error(
    `${op} is not applicable to JMX projects — JMX is an emission-only target`,
  );
}

export const JmxCodegenAdapter: LanguageCodegen = {
  generateTestClass: () => notApplicable("generateTestClass"),
  generateSuiteFiles: () => notApplicable("generateSuiteFiles"),
  addTestMethod: () => notApplicable("addTestMethod"),
  replaceHookBody: () => notApplicable("replaceHookBody"),
  readHookBody: () => Promise.resolve(null),
  isHookDefaultStub: () => Promise.resolve(false),
};

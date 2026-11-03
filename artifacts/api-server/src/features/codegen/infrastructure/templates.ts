// @ts-expect-error -- text loader provided by esbuild build config & vitest fallback
import testFixtureRaw from "@/features/codegen/infrastructure/templates/_testfixture.txt";
// @ts-expect-error -- text loader
import testFixtureBaseRaw from "@/features/codegen/infrastructure/templates/_testfixturebase.txt";
// @ts-expect-error -- text loader
import iBrowserManagerRaw from "@/features/codegen/infrastructure/templates/_ibrowsermanager.txt";
// @ts-expect-error -- text loader
import browserManagerRaw from "@/features/codegen/infrastructure/templates/_browsermanager.txt";
// @ts-expect-error -- text loader
import testContextHelperRaw from "@/features/codegen/infrastructure/templates/_testcontexthelper.txt";
// @ts-expect-error -- text loader
import testOutputLoggerRaw from "@/features/codegen/infrastructure/templates/_testoutputlogger.txt";
// @ts-expect-error -- text loader
import testTrackerRaw from "@/features/codegen/infrastructure/templates/_testtracker.txt";
// @ts-expect-error -- text loader
import testConfigRaw from "@/features/codegen/infrastructure/templates/_testconfig.txt";
// @ts-expect-error -- text loader
import constantsRaw from "@/features/codegen/infrastructure/templates/_constants.txt";
// @ts-expect-error -- text loader
import appConfigRaw from "@/features/codegen/infrastructure/templates/_appconfigurationextensions.txt";
// @ts-expect-error -- text loader
import secretClientRaw from "@/features/codegen/infrastructure/templates/_secretclientextensions.txt";
// @ts-expect-error -- text loader
import playwrightTraceRaw from "@/features/codegen/infrastructure/templates/_playwrighttraceextensions.txt";

export const TEMPLATES = {
  // Infrastructure
  testFixtureBase: testFixtureBaseRaw as string,
  testFixture: testFixtureRaw as string,
  iBrowserManager: iBrowserManagerRaw as string,
  browserManager: browserManagerRaw as string,
  // Shared
  testContextHelper: testContextHelperRaw as string,
  testOutputLogger: testOutputLoggerRaw as string,
  testTracker: testTrackerRaw as string,
  testConfig: testConfigRaw as string,
  constants: constantsRaw as string,
  appConfigurationExtensions: appConfigRaw as string,
  secretClientExtensions: secretClientRaw as string,
  playwrightTraceExtensions: playwrightTraceRaw as string,
};

export function applyNamespace(content: string, ns: string): string {
  return content.replaceAll("{{NAMESPACE}}", ns);
}

/**
 * Substitute architecture file content placeholders. Supports `{{Namespace}}`
 * (user-facing) and `{{Solution}}` (used internally by the Default architecture
 * for cross-project references in `.csproj` files). Also keeps the legacy
 * `{{NAMESPACE}}` token in step with `applyNamespace` for raw template text.
 *
 * Python architectures additionally substitute `{{Package}}` and
 * `{{TestPackage}}` — the package and tests-package names derived from the
 * solution + tests project. Both default to `{{Solution}}` /
 * `{{Solution}}_tests` (snake_cased) when not provided.
 */
export function applyTokens(
  content: string,
  vars: {
    namespace: string;
    solution: string;
    package?: string;
    testPackage?: string;
  },
): string {
  return content
    .replaceAll("{{NAMESPACE}}", vars.namespace)
    .replaceAll("{{Namespace}}", vars.namespace)
    .replaceAll("{{Solution}}", vars.solution)
    .replaceAll("{{Package}}", vars.package ?? vars.solution)
    .replaceAll("{{TestPackage}}", vars.testPackage ?? `${vars.solution}_tests`);
}

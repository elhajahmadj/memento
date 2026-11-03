import path from "node:path";
import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { AiRunReport } from "@/features/ai-agent/domain/types";
import { normalizeGivenWhenThen } from "@/features/ai-agent/infrastructure/methodNaming";
import { buildTestConfigContent } from "@/features/codegen/infrastructure/codegen";
import { pascal, safeIdentifier } from "./identifiers";
import { discoverCsharpProject } from "./discovery";
import { resolveClass } from "./resolveClass";
import { stepToPageMethod, type PageMethodSpec } from "./pageMethods";
import {
  collectAllUrlNamesFromAppsettings,
  collectNamedUrls,
  findFirstGotoUrl,
  inferFieldName,
  readJsonSafe,
  resolveUrlName,
  upsertNamedUrls,
  writeFileSafe,
} from "./appsettingsIO";
import {
  writeConstantsArtifact,
  writeInterfaceArtifact,
  writePageObjectArtifact,
  writeSelectorsArtifact,
} from "./partialClassWriters";
import { renderTestClass } from "./testClassRenderer";

export interface EmitOptions {
  projectRoot: string;
  projectName: string;
  runId: string;
  report: AiRunReport;
  targetMode: "new_suite" | "add_method";
  existingSuiteFile: string | null;
  /**
   * Verbatim plan text the user typed in the Build with AI dialog.
   * When the run targets `[SetUp]` / `[OneTimeSetUp]`, the emitter
   * persists this to a hidden `{ClassName}Setup` sidecar next to the
   * suite file so later `add_method` runs can prepend it to the LLM
   * context. Sidecars are extensionless so the test-discovery walker
   * (which dispatches by extension) ignores them and they never show
   * up in the project-tree UI.
   */
  planText?: string | undefined;
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

export async function emitCsharp(opts: EmitOptions): Promise<string[]> {
  const written: string[] = [];
  const project = await discoverCsharpProject(
    opts.projectRoot,
    opts.projectName,
  );

  const {
    className,
    suiteStem,
    pageName,
    interfaceName,
    isAddMethod,
    existingNamespace: resolvedNamespace,
  } = await resolveClass({
    projectRoot: opts.projectRoot,
    report: opts.report,
    targetMode: opts.targetMode,
    existingSuiteFile: opts.existingSuiteFile,
  });

  // ----- 1. appsettings.json: named URL keys from every navigate -----
  const firstGoto = findFirstGotoUrl(opts.report.steps);
  const firstGotoName = firstGoto ? resolveUrlName(opts.report, firstGoto) : null;
  if (firstGoto) {
    const appSettingsRel = `${project.testProjectName}/appsettings.json`;
    const changed = await upsertNamedUrls(
      safeJoin(opts.projectRoot, appSettingsRel),
      collectNamedUrls(opts.report),
    );
    if (changed) written.push(appSettingsRel);

    // Regenerate the strongly-typed TestConfig.cs so the test below
    // can read `TestConfig.GoogleBaseUrl` instead of the stringly-typed
    // `Configuration["Urls:GoogleBaseUrl"]` lookup.
    try {
      const tcRel = `${project.namespace}.Shared/Configuration/TestConfig.cs`;
      const tcAbs = safeJoin(opts.projectRoot, tcRel);
      const dirOk = await exists(path.dirname(tcAbs));
      if (dirOk) {
        const allNames = collectAllUrlNamesFromAppsettings(
          await readJsonSafe(safeJoin(opts.projectRoot, appSettingsRel)),
        );
        await writeFileSafe(
          opts.projectRoot,
          tcRel,
          buildTestConfigContent(project.namespace, allNames),
        );
        if (!written.includes(tcRel)) written.push(tcRel);
      }
    } catch {
      // best-effort: regenerator is a sidecar
    }
  }

  // ----- 2. Selectors / interface / page object impl -----
  // Only Playwright runs produce page-object methods. API runs hit
  // HttpClient directly; unit runs invoke a function under test.
  const pageMethods: PageMethodSpec[] = [];
  const selectors = new Map<string, string>(); // selector key -> raw selector
  if (opts.report.kind === "playwright") {
    for (const step of opts.report.steps) {
      for (const c of step.playwrightCalls ?? []) {
        const spec = stepToPageMethod(step, c, suiteStem);
        if (spec) {
          pageMethods.push(spec);
          if (spec.selectorKey && spec.rawSelector) {
            selectors.set(spec.selectorKey, spec.rawSelector);
          }
        }
      }
    }
  }

  if (selectors.size > 0) {
    const baseRel = `${project.testProjectName}/PageObjects/Selectors/${suiteStem}PageSelectors.cs`;
    const partialRel = `${project.testProjectName}/PageObjects/Selectors/${suiteStem}PageSelectors.AiGenerated.cs`;
    const wrote = await writeSelectorsArtifact({
      projectRoot: opts.projectRoot,
      baseRel,
      partialRel,
      ns: project.namespace,
      suiteStem,
      selectors,
      runId: opts.runId,
    });
    if (wrote) written.push(wrote);
  }

  if (pageMethods.length > 0) {
    const ifaceBaseRel = `${project.testProjectName}/PageObjects/Interfaces/${interfaceName}.cs`;
    const ifacePartialRel = `${project.testProjectName}/PageObjects/Interfaces/${interfaceName}.AiGenerated.cs`;
    const ifaceWrote = await writeInterfaceArtifact({
      projectRoot: opts.projectRoot,
      baseRel: ifaceBaseRel,
      partialRel: ifacePartialRel,
      ns: project.namespace,
      interfaceName,
      methods: pageMethods,
      runId: opts.runId,
    });
    if (ifaceWrote) written.push(ifaceWrote);

    const implBaseRel = `${project.testProjectName}/PageObjects/Actions/${pageName}.cs`;
    const implPartialRel = `${project.testProjectName}/PageObjects/Actions/${pageName}.AiGenerated.cs`;
    const implWrote = await writePageObjectArtifact({
      projectRoot: opts.projectRoot,
      baseRel: implBaseRel,
      partialRel: implPartialRel,
      ns: project.namespace,
      pageName,
      interfaceName,
      methods: pageMethods,
      suiteStem,
      runId: opts.runId,
    });
    if (implWrote) written.push(implWrote);
  }

  // ----- 3. Per-suite constants (Playwright fills only) -----
  const constants = new Map<string, string>();
  if (opts.report.kind === "playwright") {
    for (const step of opts.report.steps) {
      for (const c of step.playwrightCalls ?? []) {
        if (c.method === "page.fill" && c.value !== undefined) {
          const fieldName = inferFieldName(step) ?? "Value";
          constants.set(
            safeIdentifier(pascal(fieldName), "Value"),
            String(c.value),
          );
        }
      }
    }
  }
  if (constants.size > 0) {
    const constsBaseRel = `${project.testProjectName}/Constants/${suiteStem}Constants.cs`;
    const constsPartialRel = `${project.testProjectName}/Constants/${suiteStem}Constants.AiGenerated.cs`;
    const wrote = await writeConstantsArtifact({
      projectRoot: opts.projectRoot,
      baseRel: constsBaseRel,
      partialRel: constsPartialRel,
      ns: project.namespace,
      className: `${suiteStem}Constants`,
      consts: constants,
      runId: opts.runId,
    });
    if (wrote) written.push(wrote);
  }

  // ----- 4. Test class file (always overwritten) -----
  // In add_method mode we drop a `partial class` companion file beside
  // the existing suite (same class name as the user's hand-written
  // suite, no base class — the original file already inherits from
  // `TestFixture`). C# merges the partials at build time so a single
  // class ends up with both the hand-written and AI-authored members.
  const testRel = isAddMethod
    ? `${path.posix.dirname(opts.existingSuiteFile!)}/${className}.AiMethod.${opts.runId.slice(0, 8)}.cs`
    : `${project.testProjectName}/Tests/${className}.cs`;

  const targetMethod = opts.report.targetMethod ?? "test";

  // For add_method, the companion partial-class MUST live in the same
  // namespace as the user-selected suite — C# only merges partials
  // that share both class name AND namespace. Falling back to the
  // discovered project namespace would silently produce a sibling
  // class in a different namespace and undermine the "attach to
  // existing suite" guarantee. Use the parsed namespace; if (and
  // only if) the file genuinely had no namespace declaration we let
  // the discovered project namespace win.
  // For add_method, the companion's `classNamespace` MUST be the
  // EXACT namespace declared in the user-picked file — otherwise C#
  // refuses to merge the partials and we silently produce a sibling
  // class. For new_suite we follow the established `${root}.Tests`
  // convention. `ns` always stays rooted at the project namespace so
  // `using` directives + page-object sub-namespaces stay correct.
  const testFileClassNamespace =
    isAddMethod && resolvedNamespace
      ? resolvedNamespace
      : `${project.namespace}.Tests`;

  await writeFileSafe(
    opts.projectRoot,
    testRel,
    renderTestClass({
      ns: project.namespace,
      classNamespace: testFileClassNamespace,
      className,
      pageName,
      interfaceName,
      hasPageMethods: pageMethods.length > 0,
      hasConstants: constants.size > 0,
      suiteStem,
      runId: opts.runId,
      kind: opts.report.kind,
      steps: opts.report.steps,
      baseUrl: firstGoto,
      baseUrlName: firstGotoName,
      report: opts.report,
      methodName:
        normalizeGivenWhenThen(
          opts.report.methodName,
          opts.report.steps,
          opts.report.suiteName,
        ),
      targetMethod,
      ignore: opts.report.ignore === true,
      ignoreReason: opts.report.ignoreReason ?? null,
      partial: isAddMethod,
    }),
  );
  written.push(testRel);

  // ----- 5. Hidden {ClassName}Setup sidecar -----
  // When the user records a [SetUp] / [OneTimeSetUp] step via Build
  // with AI, persist their original plain-English plan text to a
  // hidden, extensionless sidecar next to the suite file. Later
  // add_method runs read it via `readAiSetupSidecar` and prepend it
  // to the LLM context so the AI knows what setup state the new test
  // method will run on top of. The sidecar has no extension, so the
  // test-discovery walker (which dispatches by extension) ignores it
  // and it never appears in the project-tree UI.
  if (
    (targetMethod === "beforeEach" || targetMethod === "oneTimeSetUp") &&
    typeof opts.planText === "string" &&
    opts.planText.trim().length > 0
  ) {
    const sidecarRel = `${path.posix.dirname(testRel)}/${className}Setup`;
    await writeFileSafe(opts.projectRoot, sidecarRel, opts.planText.trim());
    written.push(sidecarRel);
  }

  return written;
}

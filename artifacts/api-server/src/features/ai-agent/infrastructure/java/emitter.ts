import path from "node:path";
import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import { normalizeGivenWhenThen } from "../methodNaming";
import { injectMethodIntoExistingJava, renderJavaMethodChunk } from "./addMethod";
import { collectJavaConstants, collectJavaPageMethods, collectNamedUrlsJava } from "./collectors";
import { discoverJavaTarget } from "./discovery";
import {
  exists,
  firstGotoUrl,
  parseJavaDeclaredClass,
  parseJavaPackage,
  pascal,
  rootPackageFromTestsPackage,
  stripSuiteSuffix,
  writeFile,
} from "./helpers";
import { upsertJavaConfigClass, upsertJavaProperties } from "./properties";
import { renderJavaConstants, renderJavaPage, renderJavaTest } from "./renderers";
import type { JavaEmitOptions, JavaTestArgs } from "./types";

/**
 * Java emitter that materializes an AI run as recorder-style files
 * plugged into the JUnit 5 + Playwright Maven multi-module layout
 * produced by `scaffoldJavaFromArchitecture`, instead of dumping a
 * standalone file under `src/test/java/ai/`.
 *
 * Conventions followed (relative to the discovered tests module):
 *   src/test/java/{pkg}/tests/{Pascal}Tests.java           — JUnit test
 *   src/test/java/{pkg}/tests/{Pascal}ApiTests.java        — api kind
 *   src/test/java/{pkg}/tests/{Pascal}UnitTests.java       — unit kind
 *   src/test/java/{pkg}/pages/{Pascal}Page.java            — page object
 *   src/test/java/{pkg}/constants/{Pascal}Constants.java   — per-suite consts
 *   src/test/resources/application.properties              — base.url= (seed if absent)
 *
 * Safety model mirrors the C# emitter:
 *  - All paths flow through `safeJoin` so derived names cannot escape.
 *  - When the canonical test file already exists, the emitter writes a
 *    sibling `{Pascal}Tests_AiMethod_{shortRun}.java` with a unique
 *    class name. The original file is never modified.
 *  - Page objects use a sibling subclass file
 *    `{Pascal}PageAiAdditions.java` extending `{Pascal}Page`.
 */
export async function emitJava(opts: JavaEmitOptions): Promise<string[]> {
  const written: string[] = [];
  const isAdd = opts.targetMode === "add_method";

  // In add_method mode the user-picked existing file is authoritative
  // for package + class name. Parse it up-front so sibling artifacts
  // (page object, constants, config) land in the right package and
  // the new method attaches to the right declared class.
  let addInfo: {
    relPath: string;
    absPath: string;
    source: string;
    declaredClass: string;
    declaredPackage: string;
  } | null = null;
  if (isAdd) {
    if (!opts.existingSuiteFile) {
      throw new Error(
        "AI Agent add_method run has no existing suite file picked",
      );
    }
    const relPath = opts.existingSuiteFile;
    const absPath = safeJoin(opts.projectRoot, relPath);
    let source: string;
    try {
      source = await fs.readFile(absPath, "utf8");
    } catch {
      throw new Error(
        `Build with AI: cannot attach to '${relPath}' — file is missing or unreadable. ` +
          "Verify the file path, or switch to 'New test suite' to author a standalone suite.",
      );
    }
    const cls = parseJavaDeclaredClass(source);
    const pkg = parseJavaPackage(source);
    if (!cls || !pkg) {
      throw new Error(
        `Build with AI: cannot attach to '${relPath}' — no top-level Java class or package declaration found. ` +
          "Verify the file path, or switch to 'New test suite' to author a standalone suite.",
      );
    }
    addInfo = {
      relPath,
      absPath,
      source,
      declaredClass: cls,
      declaredPackage: pkg,
    };
  }

  const target = await discoverJavaTarget(opts.projectRoot, opts.projectName);
  // For add_method, derive the suite stem from the declared class name
  // so sibling page/constants files line up. For new_suite, use the
  // report.suiteName as before.
  const stemSource = isAdd && addInfo
    ? stripSuiteSuffix(addInfo.declaredClass)
    : stripSuiteSuffix(opts.report.suiteName);
  const suitePascal = pascal(stemSource) || "Generated";
  const shortRun = opts.runId.slice(0, 8);
  const kind = opts.report.kind;
  // In add_method mode, sibling page/constants/config emission should
  // root in the existing file's package (rather than the discovered
  // module default) so the imports the new method emits resolve.
  const pkg = isAdd && addInfo
    ? rootPackageFromTestsPackage(addInfo.declaredPackage)
    : target.pkg;
  const javaRoot = `${target.testsModuleRel}/src/test/java/${pkg}`;

  // 1. application.properties — seed `base.url` if absent, then upsert
  // each navigate URL as a named property (e.g. `google.base.url=`)
  // alongside `base.url` so generated tests can read either key.
  const firstUrl = firstGotoUrl(opts.report.steps);
  if (kind === "playwright" && firstUrl) {
    const propsRel = `${target.testsModuleRel}/src/test/resources/application.properties`;
    const propsAbs = safeJoin(opts.projectRoot, propsRel);
    const named = collectNamedUrlsJava(opts.report);
    const changed = await upsertJavaProperties(propsAbs, firstUrl, named);
    if (changed) written.push(propsRel);
  }

  // 2. Page object (Playwright only).
  if (kind === "playwright") {
    const methods = collectJavaPageMethods(opts.report.steps);
    if (methods.length > 0) {
      const baseRel = `${javaRoot}/pages/${suitePascal}Page.java`;
      const baseAbs = safeJoin(opts.projectRoot, baseRel);
      const baseExists = await exists(baseAbs);
      if (!baseExists) {
        await writeFile(
          baseAbs,
          renderJavaPage(pkg, suitePascal, methods, false),
        );
        written.push(baseRel);
      } else {
        const sibRel = `${javaRoot}/pages/${suitePascal}PageAiAdditions.java`;
        await writeFile(
          safeJoin(opts.projectRoot, sibRel),
          renderJavaPage(pkg, suitePascal, methods, true),
        );
        written.push(sibRel);
      }
    }
  }

  // 3. Constants (Playwright fills only).
  if (kind === "playwright") {
    const consts = collectJavaConstants(opts.report.steps);
    if (consts.size > 0) {
      const rel = `${javaRoot}/constants/${suitePascal}Constants.java`;
      await writeFile(
        safeJoin(opts.projectRoot, rel),
        renderJavaConstants(pkg, suitePascal, consts),
      );
      written.push(rel);
    }
  }

  // 3b. Config helper class — exposes a typed getter per named URL
  // (e.g. `getGoogleBaseUrl()`) backed by `application.properties`.
  // Only emitted when we have at least one navigate URL.
  if (kind === "playwright" && firstUrl) {
    const named = collectNamedUrlsJava(opts.report);
    const cfgRel = `${javaRoot}/config/Config.java`;
    const cfgAbs = safeJoin(opts.projectRoot, cfgRel);
    const cfgChanged = await upsertJavaConfigClass(cfgAbs, pkg, named);
    if (cfgChanged) written.push(cfgRel);
  }

  // 4. Test class.
  const suffix =
    kind === "api" ? "ApiTests" : kind === "unit" ? "UnitTests" : "Tests";
  const baseClassName = `${suitePascal}${suffix}`;
  const targetMethod = opts.report.targetMethod ?? "test";
  const methodName =
    normalizeGivenWhenThen(
      opts.report.methodName,
      opts.report.steps,
      opts.report.suiteName,
    );

  if (isAdd && addInfo) {
    // Append the new method into the user-picked existing class —
    // never drop a sibling `{Pascal}Tests_AiMethod_*.java` next to
    // it. Java has no `partial` classes, so the only way to "attach"
    // is to edit the file in place.
    const args: JavaTestArgs = {
      runId: opts.runId,
      pkg,
      className: addInfo.declaredClass,
      suitePascal,
      kind,
      steps: opts.report.steps,
      report: opts.report,
      methodName,
      targetMethod,
      ignore: opts.report.ignore === true,
      ignoreReason: opts.report.ignoreReason ?? null,
    };
    const chunk = renderJavaMethodChunk(args);
    const updated = injectMethodIntoExistingJava(
      addInfo.source,
      addInfo.declaredClass,
      chunk,
    );
    await fs.writeFile(addInfo.absPath, updated);
    written.push(addInfo.relPath);

    if (
      (targetMethod === "beforeEach" || targetMethod === "oneTimeSetUp") &&
      (opts.planText ?? "").trim().length > 0
    ) {
      const dir = path.posix.dirname(addInfo.relPath);
      const sidecarRel = `${dir}/${addInfo.declaredClass}.setup`;
      await writeFile(
        safeJoin(opts.projectRoot, sidecarRel),
        (opts.planText ?? "").trim(),
      );
      written.push(sidecarRel);
    }
    return written;
  }

  const baseRel = `${javaRoot}/tests/${baseClassName}.java`;
  const baseAbs = safeJoin(opts.projectRoot, baseRel);
  const baseExists = await exists(baseAbs);
  const className = baseExists
    ? `${suitePascal}${suffix}_AiMethod_${shortRun}`
    : baseClassName;
  const rel = `${javaRoot}/tests/${className}.java`;

  await writeFile(
    safeJoin(opts.projectRoot, rel),
    renderJavaTest({
      runId: opts.runId,
      pkg,
      className,
      suitePascal,
      kind,
      steps: opts.report.steps,
      report: opts.report,
      methodName,
      targetMethod,
      ignore: opts.report.ignore === true,
      ignoreReason: opts.report.ignoreReason ?? null,
    }),
  );
  written.push(rel);

  if (
    (targetMethod === "beforeEach" || targetMethod === "oneTimeSetUp") &&
    (opts.planText ?? "").trim().length > 0
  ) {
    const sidecarRel = `${javaRoot}/tests/${className}.setup`;
    await writeFile(
      safeJoin(opts.projectRoot, sidecarRel),
      (opts.planText ?? "").trim(),
    );
    written.push(sidecarRel);
  }

  return written;
}

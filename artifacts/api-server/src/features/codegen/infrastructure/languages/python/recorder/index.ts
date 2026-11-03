import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { AiRunReport } from "@/features/ai-agent/domain/types";
import { normalizeGivenWhenThen } from "@/features/ai-agent/infrastructure/methodNaming";
import {
  ensureInit,
  exists,
  firstGotoUrl,
  pascal,
  pySetupSidecarPath,
  snake,
  stripSuiteSuffix,
  writeFile,
} from "./helpers";
import {
  collectNamedUrlsPy,
  collectPyConstants,
  renderPyConstants,
  upsertPyConfig,
} from "./constants";
import { collectPyPageMethods, renderPyPage } from "./pageObject";
import { renderPyTest, type PyTestArgs } from "./testRendering";
import { appendToExistingPyTest } from "./appendExisting";

/**
 * Python emitter that materializes an AI run as recorder-style files
 * plugged into the pytest + Playwright + httpx project layout produced
 * by `scaffoldPythonFromArchitecture`, instead of dumping a standalone
 * file under `tests/ai/`.
 *
 * Conventions followed:
 *   tests/test_{snake_suite}.py           — pytest test (page/api/unit)
 *   pages/{snake_suite}_page.py           — page object (Playwright only)
 *   tests/constants/{snake_suite}_constants.py
 *   tests/conftest.py                     — base_url fixture (preserve)
 *
 * Safety model mirrors the C# emitter:
 *  - All paths flow through `safeJoin` so derived names cannot escape.
 *  - When the canonical test file already exists, the emitter writes a
 *    sibling `test_{snake_suite}_ai_{shortRun}.py`. The original file
 *    is never modified — Python has no `partial class` so a sibling
 *    module is the safest preservation strategy.
 *  - Page objects use the same sibling-class strategy: an
 *    `{snake}_page_ai_generated.py` exposes
 *    `class {Pascal}PageAiAdditions({Pascal}Page):` so developers can
 *    explicitly opt the new methods into their page.
 */

export interface PyEmitOptions {
  projectRoot: string;
  runId: string;
  report: AiRunReport;
  targetMode: "new_suite" | "add_method";
  /**
   * When `targetMode === "add_method"`, the project-relative POSIX
   * path of the user-selected existing pytest suite. The new
   * `def test_*` is appended to this file instead of being written
   * into a sibling `tests/test_{snake}_ai_{shortRun}.py` (which was
   * the pre-task-101 behavior and silently created a second suite).
   */
  existingSuiteFile?: string | null;
  /**
   * Verbatim plan text from the Build with AI dialog. When the run
   * targets a pytest setup primitive (`setup_method` / `setup_class`),
   * the emitter persists this to `tests/test_{snake}.setup` next to
   * the suite so later `add_method` runs can prepend it to the LLM
   * context. The sidecar is excluded from the project file tree.
   */
  planText?: string | undefined;
}

export async function emitPython(opts: PyEmitOptions): Promise<string[]> {
  const written: string[] = [];
  const suiteSnake = snake(stripSuiteSuffix(opts.report.suiteName)) || "generated";
  const suitePascal = pascal(stripSuiteSuffix(opts.report.suiteName)) || "Generated";
  const shortRun = opts.runId.slice(0, 8);
  const kind = opts.report.kind;
  const isAdd = opts.targetMode === "add_method";

  // 1. config.py — seed if absent, then upsert named URL constants.
  // Each navigate URL gets a `<NAME>_BASE_URL` constant alongside the
  // back-compat `BASE_URL` so generated tests can read e.g.
  // `config.GOOGLE_BASE_URL` instead of the unscoped `BASE_URL`.
  const firstUrl = firstGotoUrl(opts.report.steps);
  if (kind === "playwright" && firstUrl) {
    const cfgRel = "config.py";
    const cfgAbs = safeJoin(opts.projectRoot, cfgRel);
    const named = collectNamedUrlsPy(opts.report);
    const changed = await upsertPyConfig(cfgAbs, firstUrl, named);
    if (changed) written.push(cfgRel);
  }

  // 2. Page object (Playwright only) — sibling class if base exists.
  if (kind === "playwright") {
    const methods = collectPyPageMethods(opts.report.steps);
    if (methods.length > 0) {
      const baseRel = `pages/${suiteSnake}_page.py`;
      const baseAbs = safeJoin(opts.projectRoot, baseRel);
      const baseExists = await exists(baseAbs);
      if (!baseExists) {
        await writeFile(
          baseAbs,
          renderPyPage(suitePascal, methods, /*isAdditions*/ false, null),
        );
        written.push(baseRel);
      } else {
        const sibRel = `pages/${suiteSnake}_page_ai_generated.py`;
        await writeFile(
          safeJoin(opts.projectRoot, sibRel),
          renderPyPage(suitePascal, methods, /*isAdditions*/ true, suiteSnake),
        );
        written.push(sibRel);
      }
    }
  }

  // 3. Constants (Playwright fills only).
  if (kind === "playwright") {
    const consts = collectPyConstants(opts.report.steps);
    if (consts.size > 0) {
      const rel = `tests/constants/${suiteSnake}_constants.py`;
      await writeFile(
        safeJoin(opts.projectRoot, rel),
        renderPyConstants(consts),
      );
      written.push(rel);
      // Ensure the constants package is importable.
      await ensureInit(opts.projectRoot, "tests/constants/__init__.py", written);
    }
  }

  // 4. Test file. In `add_method` mode, append the new `def test_*`
  //    into the user-selected existing suite — NEVER create a sibling
  //    `tests/test_{snake}_ai_{shortRun}.py` (that was the pre-task-101
  //    bug where "Add to existing suite" silently created a second
  //    suite file). The materializer has already validated that
  //    `existingSuiteFile` is a project-relative POSIX path.
  //
  //    For `new_suite` we keep the canonical path; on collision we
  //    still fall back to a sibling so two distinct `new_suite` runs
  //    don't clobber each other.
  const methodName = normalizeGivenWhenThen(
    opts.report.methodName,
    opts.report.steps,
    opts.report.suiteName,
  );
  const targetMethod = opts.report.targetMethod ?? "test";
  const renderArgs: PyTestArgs = {
    runId: opts.runId,
    suitePascal,
    suiteSnake,
    kind,
    steps: opts.report.steps,
    report: opts.report,
    methodName,
    targetMethod,
    ignore: opts.report.ignore === true,
    ignoreReason: opts.report.ignoreReason ?? null,
  };

  let testRel: string;
  if (isAdd) {
    if (!opts.existingSuiteFile) {
      throw new Error(
        "Build with AI: add_method requested but no existing suite file was selected. " +
          "Pick a suite from the 'Existing suite file' dropdown or switch to 'New test suite'.",
      );
    }
    testRel = opts.existingSuiteFile;
    const targetAbs = safeJoin(opts.projectRoot, testRel);
    if (!(await exists(targetAbs))) {
      throw new Error(
        `Build with AI: cannot attach to '${testRel}' — file not found. ` +
          "Verify the file path, or switch to 'New test suite' to author a standalone suite.",
      );
    }
    await appendToExistingPyTest(targetAbs, opts.runId, renderArgs);
  } else {
    const testBaseRel = `tests/test_${suiteSnake}.py`;
    const testAbs = safeJoin(opts.projectRoot, testBaseRel);
    const testExists = await exists(testAbs);
    testRel = testExists
      ? `tests/test_${suiteSnake}_ai_${shortRun}.py`
      : testBaseRel;
    await writeFile(
      safeJoin(opts.projectRoot, testRel),
      renderPyTest(renderArgs),
    );
  }
  written.push(testRel);
  await ensureInit(opts.projectRoot, "tests/__init__.py", written);

  // 5. Hidden `.setup` sidecar.
  //    When the user records a `setup_method` / `setup_class` step via
  //    Build with AI, persist their original plain-English plan text
  //    to `tests/test_{snake}.setup` next to the suite. Later
  //    `add_method` runs read it via `readAiSetupSidecar` and prepend
  //    it to the LLM context so the AI knows what setup state the new
  //    test method will run on top of. The `.setup` extension is
  //    excluded from the project file tree (see `projectService.ts`).
  if (
    (targetMethod === "beforeEach" || targetMethod === "oneTimeSetUp") &&
    typeof opts.planText === "string" &&
    opts.planText.trim().length > 0
  ) {
    const sidecarRel = pySetupSidecarPath(testRel);
    await writeFile(
      safeJoin(opts.projectRoot, sidecarRel),
      opts.planText.trim(),
    );
    written.push(sidecarRel);
  }

  return written;
}

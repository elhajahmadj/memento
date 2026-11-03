import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { AiRunReport } from "@/features/ai-agent/domain/types";
import {
  normalizeGivenWhenThen,
} from "@/features/ai-agent/infrastructure/methodNaming";
import {
  exists,
  firstGotoUrl,
  kebab,
  nodeSetupSidecarPath,
  pascal,
  stripSuiteSuffix,
  writeFile,
} from "./helpers";
import {
  collectNamedUrlsNode,
  collectNodeConstants,
  collectNodePageMethods,
} from "./collectors";
import { upsertNodeConfig } from "./config";
import {
  renderNodeConstants,
  renderNodePage,
  renderNodeSpec,
  type NodeSpecArgs,
} from "./renderers";
import { appendToExistingNodeSpec } from "./specAppend";

/**
 * Node.js emitter that materializes an AI run as recorder-style files
 * plugged into the @playwright/test project layout produced by
 * `scaffoldNodejsFromArchitecture`, instead of dumping a standalone
 * file under `tests/ai/`.
 *
 * Conventions followed:
 *   tests/{kebab_suite}.spec.ts            — playwright spec
 *   tests/{kebab_suite}.api.spec.ts        — api kind (uses `request` fixture)
 *   tests/{kebab_suite}.unit.spec.ts       — unit kind
 *   pages/{Pascal}Page.ts                  — page object class
 *   tests/constants/{kebab_suite}-constants.ts
 *   tests/config.ts                        — BASE_URL constant (seed if absent)
 *
 * Safety model mirrors the C# emitter:
 *  - All paths flow through `safeJoin` so derived names cannot escape.
 *  - When the canonical spec file already exists, the emitter writes a
 *    sibling `{kebab}.ai-{shortRun}.spec.ts`. The original file is
 *    never modified.
 *  - Page objects use a sibling subclass file
 *    `pages/{Pascal}Page.AiGenerated.ts` exporting
 *    `class {Pascal}PageAiAdditions extends {Pascal}Page` so the new
 *    methods are explicitly opt-in.
 */
export interface NodeEmitOptions {
  projectRoot: string;
  runId: string;
  report: AiRunReport;
  targetMode: "new_suite" | "add_method";
  /**
   * When `targetMode === "add_method"`, the project-relative POSIX
   * path of the user-selected existing @playwright/test spec.
   */
  existingSuiteFile?: string | null | undefined;
  /**
   * Verbatim plan text from the Build with AI dialog. When the run
   * targets a Playwright hook, persisted to a `{stem}.setup` sidecar.
   */
  planText?: string | undefined;
}

export async function emitNode(opts: NodeEmitOptions): Promise<string[]> {
  const written: string[] = [];
  const stem = stripSuiteSuffix(opts.report.suiteName);
  const suiteKebab = kebab(stem) || "generated";
  const suitePascal = pascal(stem) || "Generated";
  const shortRun = opts.runId.slice(0, 8);
  const kind = opts.report.kind;
  const isAdd = opts.targetMode === "add_method";
  const targetMethod = opts.report.targetMethod ?? "test";

  // 1. tests/config.ts — seed named URL constants.
  const firstUrl = firstGotoUrl(opts.report.steps);
  if (kind === "playwright" && firstUrl) {
    const cfgRel = "tests/config.ts";
    const cfgAbs = safeJoin(opts.projectRoot, cfgRel);
    const named = collectNamedUrlsNode(opts.report);
    const changed = await upsertNodeConfig(cfgAbs, firstUrl, named);
    if (changed) written.push(cfgRel);
  }

  // 2. Page object (Playwright only).
  if (kind === "playwright") {
    const methods = collectNodePageMethods(opts.report.steps);
    if (methods.length > 0) {
      const baseRel = `pages/${suitePascal}Page.ts`;
      const baseAbs = safeJoin(opts.projectRoot, baseRel);
      const baseExists = await exists(baseAbs);
      if (!baseExists) {
        await writeFile(baseAbs, renderNodePage(suitePascal, methods, false));
        written.push(baseRel);
      } else {
        const sibRel = `pages/${suitePascal}Page.AiGenerated.ts`;
        await writeFile(
          safeJoin(opts.projectRoot, sibRel),
          renderNodePage(suitePascal, methods, true),
        );
        written.push(sibRel);
      }
    }
  }

  // 3. Constants (Playwright fills only).
  if (kind === "playwright") {
    const consts = collectNodeConstants(opts.report.steps);
    if (consts.size > 0) {
      const rel = `tests/constants/${suiteKebab}-constants.ts`;
      await writeFile(
        safeJoin(opts.projectRoot, rel),
        renderNodeConstants(consts),
      );
      written.push(rel);
    }
  }

  // 4. Spec file.
  const ext =
    kind === "api" ? `.api.spec.ts` : kind === "unit" ? `.unit.spec.ts` : `.spec.ts`;
  const methodName = normalizeGivenWhenThen(
    opts.report.methodName,
    opts.report.steps,
    opts.report.suiteName,
  );
  const specArgs: NodeSpecArgs = {
    runId: opts.runId,
    suitePascal,
    suiteKebab,
    kind,
    steps: opts.report.steps,
    report: opts.report,
    methodName,
    targetMethod,
    ignore: opts.report.ignore === true,
    ignoreReason: opts.report.ignoreReason ?? null,
  };

  let rel: string;
  if (isAdd) {
    if (!opts.existingSuiteFile) {
      throw new Error(
        "Build with AI: add_method requested but no existing suite file was selected. " +
          "Pick a suite from the 'Existing suite file' dropdown or switch to 'New test suite'.",
      );
    }
    rel = opts.existingSuiteFile;
    const targetAbs = safeJoin(opts.projectRoot, rel);
    if (!(await exists(targetAbs))) {
      throw new Error(
        `Build with AI: cannot attach to '${rel}' — file not found. ` +
          "Verify the file path, or switch to 'New test suite' to author a standalone suite.",
      );
    }
    await appendToExistingNodeSpec(targetAbs, opts.runId, specArgs);
  } else {
    const baseRel = `tests/${suiteKebab}${ext}`;
    const baseAbs = safeJoin(opts.projectRoot, baseRel);
    const baseExists = await exists(baseAbs);
    rel = baseExists ? `tests/${suiteKebab}.ai-${shortRun}${ext}` : baseRel;
    await writeFile(safeJoin(opts.projectRoot, rel), renderNodeSpec(specArgs));
  }
  written.push(rel);

  // 5. Hidden `.setup` sidecar for hook targets.
  if (
    (targetMethod === "beforeEach" || targetMethod === "oneTimeSetUp") &&
    typeof opts.planText === "string" &&
    opts.planText.trim().length > 0
  ) {
    const sidecarRel = nodeSetupSidecarPath(rel);
    await writeFile(
      safeJoin(opts.projectRoot, sidecarRel),
      opts.planText.trim(),
    );
    written.push(sidecarRel);
  }

  return written;
}

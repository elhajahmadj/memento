import { eq } from "drizzle-orm";
import { db, aiRunsTable, type AiRun } from "@workspace/db";
import { logger } from "@/shared/logger";
import {
  AiAgentDisabledError,
  type AiRunReport,
  type AiRunStep,
  type AiTargetMethod,
  type AiTestKind,
} from "@/features/ai-agent/domain/types";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  assertAgentReady,
  upsertCatalogMethod,
  upsertCatalogSelector,
  upsertCatalogCategory,
} from "./aiAgentService";
import { parsePlan } from "./parser";
import { chat } from "./llmProviders";
import { materializeRun } from "./materializer";
import { deriveUrlName } from "./urlNaming";
import { deriveGivenWhenThen, normalizeGivenWhenThen } from "./methodNaming";
import { readSetupChain, readAiSetupSidecar } from "./setupChain";

/**
 * Kick off an AI run in the background. Returns immediately with the
 * created `aiRunsTable` row (status = `pending`); the actual work
 * happens in `void` task that updates the row when finished.
 *
 * The runner v1 does not actually launch a browser — it interprets
 * the plan into a structured report and materializes the test files.
 * The user can then run the materialized tests via the existing
 * test-discovery / selection-run infrastructure.
 */
export async function startAiRun(opts: {
  organizationId: string | null;
  projectName: string;
  kind: AiTestKind;
  suiteName: string;
  /**
   * Optional caller-supplied test method name. When provided and
   * shaped like a valid identifier the runner uses it verbatim
   * instead of deriving `Given<X>_When<Y>_Then<Z>`. Blank / null
   * keeps the existing auto-derived behavior.
   */
  methodName?: string | null | undefined;
  planText: string;
  category?: string | undefined;
  language: "csharp" | "python" | "nodejs" | "java";
  targetMode?: "new_suite" | "add_method" | undefined;
  existingSuiteFile?: string | null | undefined;
  targetMethod?: AiTargetMethod | undefined;
  ignore?: boolean | undefined;
  ignoreReason?: string | null | undefined;
  triggeredByUserId: string;
}): Promise<AiRun> {
  // Reject the ignore + non-test-target combination up front.
  // BeforeEach / OneTimeSetUp hooks have no body the runtime can mark
  // as ignored — NUnit's [Ignore] attribute is only valid on test
  // methods, and the same is true for pytest.skip / test.skip
  // / @Disabled / etc. Surface a clear 4xx instead of silently
  // dropping the ignore flag inside an emitter.
  const targetMethod = opts.targetMethod ?? "test";
  if (opts.ignore === true && targetMethod !== "test") {
    throw new Error(
      "ignore=true cannot be combined with a setup hook target. " +
        "Choose targetMethod=test, or clear the Ignore checkbox.",
    );
  }

  // Pre-flight: throws AiAgentDisabledError on org/project/no-key.
  const provider = await assertAgentReady({
    organizationId: opts.organizationId,
    projectName: opts.projectName,
  });

  const [run] = await db
    .insert(aiRunsTable)
    .values({
      projectName: opts.projectName,
      kind: opts.kind,
      suiteName: opts.suiteName,
      planText: opts.planText,
      status: "pending",
      triggeredByUserId: opts.triggeredByUserId,
    })
    .returning();

  const created = run!;

  // Fire-and-forget. Errors are caught and persisted on the row so the
  // UI can surface them without crashing the server.
  void executeRun({
    runId: created.id,
    projectName: opts.projectName,
    kind: opts.kind,
    suiteName: opts.suiteName,
    methodName: opts.methodName ?? null,
    planText: opts.planText,
    category: opts.category,
    language: opts.language,
    targetMode: opts.targetMode ?? "new_suite",
    existingSuiteFile: opts.existingSuiteFile ?? null,
    targetMethod: opts.targetMethod ?? "test",
    ignore: opts.ignore === true,
    ignoreReason: opts.ignore === true ? (opts.ignoreReason ?? null) : null,
    provider,
  }).catch((err) => {
    logger.error({ err, runId: created.id }, "AI run failed unexpectedly");
  });

  return created;
}

interface ExecuteOpts {
  runId: string;
  projectName: string;
  kind: AiTestKind;
  suiteName: string;
  methodName: string | null;
  planText: string;
  category?: string | undefined;
  language: "csharp" | "python" | "nodejs" | "java";
  targetMode: "new_suite" | "add_method";
  existingSuiteFile: string | null;
  targetMethod: AiTargetMethod;
  ignore: boolean;
  ignoreReason: string | null;
  provider: import("./aiAgentService").DecryptedProviderCreds;
}

async function executeRun(opts: ExecuteOpts): Promise<void> {
  await db
    .update(aiRunsTable)
    .set({ status: "running" })
    .where(eq(aiRunsTable.id, opts.runId));

  try {
    const parsed = parsePlan(opts.planText, opts.kind);
    // Authoritative bound for the OUTPUT step count. The user's plan
    // is the only source of new steps; the LLM enrichment pass is
    // strictly 1-to-1 with `unmatched` lines (it never invents new
    // ones). When the run is `add_method` against a suite that has a
    // setup sidecar, we feed that sidecar to the LLM as CONTEXT only
    // (so the AI knows what state already exists) — it MUST NOT be
    // re-emitted as new steps for this method. The bound below is
    // the explicit guard against that "setup-context bleed":
    // `steps.length > newPlanLineCount` indicates the LLM (or a
    // future enrichment path) generated more steps than the user
    // typed, which we trim back to the user's plan length.
    const newPlanLineCount = parsed.length;

    // For lines the rule parser couldn't classify, ask the LLM to
    // turn each into a one-line action description (best-effort —
    // failures are tolerated and the unrecognised line stays in the
    // report for manual review).
    // Pre-compute setup-chain context so we can prepend it to the LLM
    // enrichment prompt below (and stamp it on the report for UI
    // visibility). For new suites or non-test targets this stays
    // empty — the runner has already rejected the ignore+hook
    // combination upstream.
    let setupContext: string | null = null;
    if (
      opts.targetMode === "add_method" &&
      opts.existingSuiteFile &&
      opts.targetMethod === "test"
    ) {
      try {
        const projectRoot = path.join(
          recorderConfig.workspaceDir,
          opts.projectName,
        );
        const codeContext = await readSetupChain({
          projectRoot,
          existingSuiteFile: opts.existingSuiteFile,
          language: opts.language,
        });
        // The user's original plain-English plan for any prior
        // [SetUp] / [OneTimeSetUp] run we authored lives in a hidden
        // `{ClassName}Setup` sidecar next to the suite file. Prepend
        // those lines so the LLM sees the prior setup intent and
        // doesn't re-author it as part of the new test method.
        const sidecar = await readAiSetupSidecar({
          projectRoot,
          existingSuiteFile: opts.existingSuiteFile,
          language: opts.language,
        });
        setupContext =
          [sidecar ? `User setup plan:\n${sidecar}` : null, codeContext]
            .filter((s): s is string => !!s && s.length > 0)
            .join("\n\n") || null;
      } catch (err) {
        logger.warn(
          { err, runId: opts.runId },
          "Failed to read setup-chain context",
        );
      }
    }

    const unmatched = parsed.filter(
      (p) => p.step.method.matchType === "none",
    );
    if (unmatched.length > 0 && unmatched.length <= 20) {
      try {
        const completion = await chat(
          {
            provider: opts.provider.provider,
            apiKey: opts.provider.apiKey,
            extras: opts.provider.extras,
          },
          [
            {
              role: "system",
              content: [
                "You translate plain-English test-step lines into a JSON",
                'array of objects shaped { input, methodName, kind } where',
                'kind is one of "playwright" | "api" | "unit". Return only',
                "the JSON array, no prose.",
                "",
                "Naming conventions for methodName (CRITICAL — these become",
                "page-object methods that get plugged into the existing",
                "Memento test architecture, NOT a new throwaway namespace):",
                "  - Verb + Noun, no Async suffix (the emitter appends it).",
                '  - Click steps  -> "Click<Target>"   e.g. "ClickLoginButton"',
                '  - Fill/type    -> "Fill<Field>"     e.g. "FillUsername"',
                '  - Visibility   -> "AssertVisible<Target>"',
                '  - URL asserts  -> "AssertUrlContains"',
                "  - Use PascalCase, ASCII letters and digits only.",
                "  - Reuse the same Noun across steps that touch the same UI",
                "    element so the page object stays cohesive.",
                "Do NOT invent new file structures. The emitter writes into",
                "{Project}.Tests/{PageObjects,Selectors,Interfaces,Constants,",
                "Tests}/ following the existing recorder layout.",
                "",
                "Method-naming convention for the OUTER test method (the one",
                "the emitter wraps these calls in): Given<X>_When<Y>_Then<Z>",
                "in PascalCase, joined by single underscores. The emitter",
                "derives this from the suite name + steps; do not invent a",
                "competing name in your output.",
                ...(setupContext
                  ? [
                      "",
                      "EXISTING SUITE CONTEXT (do not duplicate this setup —",
                      "the new method runs after these hooks):",
                      "```",
                      setupContext.slice(0, 4000),
                      "```",
                    ]
                  : []),
              ].join("\n"),
            },
            {
              role: "user",
              content: unmatched.map((u) => `- ${u.raw}`).join("\n"),
            },
          ],
          { maxTokens: 800 },
        );
        const enriched = tryParseJsonArray(completion.text);
        logger.debug(
          {
            runId: opts.runId,
            finishReason: completion.finishReason,
            usage: completion.usage,
          },
          "LLM enrichment completion received",
        );
        if (enriched && enriched.length === unmatched.length) {
          unmatched.forEach((u, i) => {
            const e = enriched[i] as { methodName?: string } | undefined;
            if (e?.methodName) {
              u.step.method.name = e.methodName;
              u.step.method.matchType = "semantic";
              u.step.method.confidence = 0.5;
              u.step.method.source = "ai-created";
            }
          });
        }
      } catch (err) {
        logger.warn(
          { err, runId: opts.runId },
          "LLM enrichment of unrecognised lines failed; continuing with raw entries",
        );
      }
    }

    let steps: AiRunStep[] = parsed.map((p, i) => ({
      ...p.step,
      index: i,
      result: p.step.method.matchType === "none" ? "skipped" : "passed",
    }));

    // Setup-context over-emission guard. If steps somehow exceed the
    // number of lines in the user's new plan — e.g. a future
    // enrichment path that fans out one plan line into several, or
    // an LLM that hallucinated extra steps off the prior-setup
    // context — trim back to the user's plan length and re-index so
    // the materialized test reflects only what the user asked for.
    if (steps.length > newPlanLineCount) {
      const trimmedCount = steps.length - newPlanLineCount;
      logger.warn(
        {
          runId: opts.runId,
          newPlanLineCount,
          producedSteps: steps.length,
          trimmedCount,
          targetMode: opts.targetMode,
          existingSuiteFile: opts.existingSuiteFile,
        },
        "AI run produced more steps than the user's plan had lines; trimming over-emitted steps (setup-context bleed guard)",
      );
      steps = steps.slice(0, newPlanLineCount).map((s, i) => ({
        ...s,
        index: i,
      }));
    }

    // Derive the named URL constants for every navigate step. Stored
    // on the report so all four emitters reference the same identifier
    // (e.g. `GoogleBaseUrl`) in their generated test + config files.
    const urlNamesMap = new Map<string, string>();
    for (const s of steps) {
      for (const c of s.playwrightCalls ?? []) {
        if (c.method === "page.goto" && c.args?.[0]) {
          const url = String(c.args[0]);
          if (!urlNamesMap.has(url)) {
            urlNamesMap.set(url, deriveUrlName(url));
          }
        }
      }
    }
    const urlNames = Array.from(urlNamesMap.entries()).map(([url, name]) => ({
      url,
      name,
    }));

    // Method name: use the caller-supplied identifier verbatim when
    // present (the "Build with AI" dialog lets users type one and
    // leave it blank to defer to the auto-derive). Otherwise fall
    // back to deriving Given<X>_When<Y>_Then<Z> from the steps.
    const methodName = opts.methodName
      ? normalizeGivenWhenThen(opts.methodName, steps, opts.suiteName)
      : deriveGivenWhenThen(steps, opts.suiteName);

    if (setupContext) {
      logger.debug(
        { runId: opts.runId, length: setupContext.length },
        "Extracted setup-chain context from existing suite (fed into LLM prompt)",
      );
    }

    // If literally every step ended up skipped (rule parser matched
    // nothing AND the LLM fallback either failed or wasn't reached),
    // fail the run with a clear message instead of "succeeding" with
    // an empty test class — that's the silent-no-op trap the user
    // hits when their Anthropic key is invalid and their plan uses
    // wording the rule parser can't recognise.
    if (steps.length > 0 && steps.every((s) => s.result === "skipped")) {
      throw new Error(
        "AI Agent could not interpret any step in your plan. " +
          "Either reword the steps using supported verbs (Navigate / Click / " +
          "Fill / Assert URL / Assert visible) OR set a valid provider API " +
          "key in Tools → AI Agent so the LLM fallback can translate them.",
      );
    }

    // Track catalog deltas — anything the agent invented that wasn't
    // already in the per-project catalog. We persist them so the
    // catalog grows over time.
    const catalogDeltas = {
      newMethods: [] as Array<{
        name: string;
        params?: string[];
        createdInRun: string;
      }>,
      newSelectors: [] as Array<{
        name: string;
        selector: string;
        createdInRun: string;
      }>,
      newCategories: [] as string[],
    };

    for (const s of steps) {
      if (s.method.source === "ai-created") {
        const upserted = await upsertCatalogMethod({
          projectName: opts.projectName,
          name: s.method.name,
          source: "ai",
          confidence: s.method.confidence,
          createdInRunId: opts.runId,
        });
        if (upserted.created) {
          catalogDeltas.newMethods.push({
            name: s.method.name,
            createdInRun: opts.runId,
          });
        }
      }
      for (const c of s.playwrightCalls ?? []) {
        if (c.rawSelector) {
          const selName =
            c.selector
              ?.replace(/^\W+/, "")
              .replace(/[^a-zA-Z0-9]+/g, "_")
              .slice(0, 32) || "selector";
          const upserted = await upsertCatalogSelector({
            projectName: opts.projectName,
            name: selName,
            selector: c.rawSelector,
            source: "ai",
            confidence: 0.6,
            createdInRunId: opts.runId,
          });
          if (upserted.created) {
            catalogDeltas.newSelectors.push({
              name: selName,
              selector: c.rawSelector,
              createdInRun: opts.runId,
            });
          }
        }
      }
    }

    if (opts.category) {
      const upserted = await upsertCatalogCategory({
        projectName: opts.projectName,
        name: opts.category,
        source: "ai",
        createdInRunId: opts.runId,
      });
      if (upserted.created) catalogDeltas.newCategories.push(opts.category);
    }

    const report: AiRunReport = {
      runId: opts.runId,
      kind: opts.kind,
      suiteName: opts.suiteName,
      status: "succeeded",
      categories: opts.category ? [opts.category] : [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      steps,
      catalogDeltas,
      targetMethod: opts.targetMethod,
      ignore: opts.ignore,
      ignoreReason: opts.ignoreReason,
      methodName,
      urlNames,
      setupContextText: setupContext,
    };

    let materializedFiles: string[] = [];
    try {
      materializedFiles = await materializeRun({
        projectName: opts.projectName,
        runId: opts.runId,
        language: opts.language,
        kind: opts.kind,
        report,
        targetMode: opts.targetMode,
        existingSuiteFile: opts.existingSuiteFile,
        planText: opts.planText,
      });
    } catch (matErr) {
      logger.warn(
        { err: matErr, runId: opts.runId },
        "Materialization failed; report still saved",
      );
    }

    await db
      .update(aiRunsTable)
      .set({
        status: "succeeded",
        report,
        materializedFiles,
        finishedAt: new Date(),
      })
      .where(eq(aiRunsTable.id, opts.runId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, runId: opts.runId }, "AI run errored");
    await db
      .update(aiRunsTable)
      .set({
        status: "failed",
        errorMessage: message,
        finishedAt: new Date(),
      })
      .where(eq(aiRunsTable.id, opts.runId));
  }
}

function tryParseJsonArray(s: string): unknown[] | null {
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export { AiAgentDisabledError };

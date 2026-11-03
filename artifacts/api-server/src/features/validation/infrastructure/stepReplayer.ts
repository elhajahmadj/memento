import type { Page } from "playwright";
import { normalizeSelectorForLocator } from "@/features/codegen/infrastructure/codegen";
import type { ReplayEventBus, ValidationStartArgs } from "../application/ports";
import {
  MAX_RUN_DURATION_MS,
  PER_STEP_TIMEOUT_MS,
  type ValidationStep,
} from "../domain/validationStep";
import { runAssertStep } from "./assertionRunner";

export interface StepReplayOutcome {
  outcome: "passed" | "failed" | "error";
  failureMessage: string | null;
}

export interface ReplayStepsArgs {
  page: Page;
  steps: ValidationStep[];
  args: ValidationStartArgs;
  startedAt: number;
  runId: string;
  events: ReplayEventBus;
  responseCtx: { lastMainFrameStatus: number | null };
  projectName: string;
  startUrl: string;
}

/**
 * Run the initial navigate (step 0) followed by every user-recorded
 * step (1..n). Updates each `ValidationStep` in place and emits
 * step-running/step-passed/step-failed events through the bus.
 */
export async function replaySteps(p: ReplayStepsArgs): Promise<StepReplayOutcome> {
  const { page, steps, args, startedAt, runId, events, responseCtx, projectName, startUrl } = p;

  const navStart = Date.now();
  try {
    steps[0]!.status = "running";
    events.push(runId, { type: "step-running", index: 0 });
    await page.goto(startUrl, { timeout: PER_STEP_TIMEOUT_MS });
    steps[0]!.status = "passed";
    steps[0]!.durationMs = Date.now() - navStart;
    events.push(runId, {
      type: "step-passed",
      index: 0,
      durationMs: steps[0]!.durationMs,
    });
  } catch (err) {
    steps[0]!.status = "failed";
    steps[0]!.durationMs = Date.now() - navStart;
    steps[0]!.error = err instanceof Error ? err.message : String(err);
    events.push(runId, {
      type: "step-failed",
      index: 0,
      durationMs: steps[0]!.durationMs,
      error: steps[0]!.error,
    });
    return { outcome: "failed", failureMessage: steps[0]!.error };
  }

  for (let i = 1; i < steps.length; i++) {
    if (events.isCancelled(runId)) {
      return { outcome: "error", failureMessage: "Run cancelled — recording was discarded." };
    }
    if (Date.now() - startedAt > MAX_RUN_DURATION_MS) {
      return {
        outcome: "error",
        failureMessage: `Run exceeded the ${MAX_RUN_DURATION_MS}ms time limit`,
      };
    }
    const step = steps[i]!;
    step.status = "running";
    events.push(runId, { type: "step-running", index: step.index });
    const stepStart = Date.now();
    try {
      await dispatchStep({ page, step, events, runId, responseCtx, projectName });
      step.status = "passed";
      step.durationMs = Date.now() - stepStart;
      events.push(runId, {
        type: "step-passed",
        index: step.index,
        durationMs: step.durationMs,
      });
    } catch (err) {
      step.status = "failed";
      step.durationMs = Date.now() - stepStart;
      step.error = err instanceof Error ? err.message : String(err);
      // Best-effort capture of the live page URL + a bounded DOM
      // snippet at the moment of failure. Sent alongside the
      // `step-failed` event so the "Fix selector" dialog (AI / re-pick
      // tabs) can ground its suggestion in what the page actually
      // looked like rather than just the broken selector string.
      // Capture is wrapped in try/catch — never let the capture itself
      // turn a failed step into a crashed run.
      let pageUrl: string | null = null;
      let domSnippet: string | null = null;
      try {
        pageUrl = page.url();
      } catch {
        /* ignore */
      }
      try {
        const fullHtml = await page.content();
        // Cap at ~16 KiB so a giant SPA payload doesn't bloat the
        // event stream or the eventual AI prompt. We strip the most
        // obvious noise (script/style bodies) before slicing.
        const compact = fullHtml
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<!--[\s\S]*?-->/g, "");
        domSnippet = compact.length > 16384 ? compact.slice(0, 16384) : compact;
      } catch {
        /* ignore */
      }
      events.push(runId, {
        type: "step-failed",
        index: step.index,
        durationMs: step.durationMs,
        error: step.error,
        selector: step.selector,
        pageUrl,
        domSnippet,
        failedAt: step.selector
          ? {
              source: {
                filePath: args.filePath,
                kind: args.kind,
                methodName: args.methodName ?? null,
              },
              stepIndex: step.index,
              selector: step.selector,
              pageUrl,
              domSnippet,
            }
          : null,
      });
      return { outcome: "failed", failureMessage: step.error };
    }
  }
  return { outcome: "passed", failureMessage: null };
}

async function dispatchStep(p: {
  page: Page;
  step: ValidationStep;
  events: ReplayEventBus;
  runId: string;
  responseCtx: { lastMainFrameStatus: number | null };
  projectName: string;
}): Promise<void> {
  const { page, step, events, runId, responseCtx, projectName } = p;
  if (step.type === "assert") {
    if (step.assertKind === "route-mock") {
      let parsed: {
        urlPattern: string;
        method: string;
        status: number;
        body: string;
      } | null = null;
      try {
        parsed = JSON.parse(step.value ?? "{}");
      } catch {
        parsed = null;
      }
      if (!parsed || !parsed.urlPattern) {
        throw new Error("route-mock step missing urlPattern");
      }
      const want = parsed.method.toUpperCase();
      await page.route(parsed.urlPattern, async (route) => {
        if (want !== "ALL" && route.request().method().toUpperCase() !== want) {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: parsed!.status,
          contentType: "application/json",
          body: parsed!.body,
        });
      });
      return;
    }
    await runAssertStep(page, step, responseCtx, projectName, {
      push: (e) => events.push(runId, e),
    });
    return;
  }
  if (step.type === "navigate") {
    const url = step.value;
    if (!url) throw new Error("navigate step has no url");
    await page.goto(url, { timeout: PER_STEP_TIMEOUT_MS });
    return;
  }
  if (step.type === "wait") {
    switch (step.waitKind) {
      case "selector": {
        const sel = step.waitSelector ?? step.selector ?? "";
        if (!sel) throw new Error("wait[selector] step has no waitSelector");
        await page
          .locator(normalizeSelectorForLocator(sel, step.selectorStrategy ?? undefined))
          .first()
          .waitFor({ timeout: PER_STEP_TIMEOUT_MS });
        return;
      }
      case "networkidle":
        await page.waitForLoadState("networkidle", { timeout: PER_STEP_TIMEOUT_MS });
        return;
      case "timeout": {
        const ms = typeof step.waitMs === "number" && step.waitMs > 0 ? step.waitMs : 500;
        await page.waitForTimeout(ms);
        return;
      }
      default:
        throw new Error(`wait step has unknown waitKind: ${String(step.waitKind)}`);
    }
  }

  const sel = step.selector!;
  const loc = page
    .locator(normalizeSelectorForLocator(sel, step.selectorStrategy ?? undefined))
    .first();
  switch (step.type) {
    case "click":
      await loc.click({ timeout: PER_STEP_TIMEOUT_MS });
      return;
    case "fill":
      await loc.fill(step.value ?? "", { timeout: PER_STEP_TIMEOUT_MS });
      return;
    case "select":
      await loc.selectOption(step.value ?? "", { timeout: PER_STEP_TIMEOUT_MS });
      return;
    case "check":
      await loc.check({ timeout: PER_STEP_TIMEOUT_MS });
      return;
    default:
      return;
  }
}

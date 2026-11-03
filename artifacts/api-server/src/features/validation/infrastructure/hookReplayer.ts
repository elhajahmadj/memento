import type { Page } from "playwright";
import { normalizeSelectorForLocator } from "@/features/codegen/infrastructure/codegen";
import type { StoredHookActionSet } from "@/features/recording/infrastructure/recordedActionStore";
import type { HookKind, ReplayEventBus } from "../application/ports";
import { PER_STEP_TIMEOUT_MS } from "../domain/validationStep";

export interface HookReplayOutcome {
  ok: boolean;
  failureMessage: string | null;
}

/**
 * Replay the recorded hook actions (oneTimeSetup, beforeEach) against
 * a Playwright page in the documented order. Returns `ok: false` on
 * cancellation or hook failure so the caller can abort the run before
 * the user steps execute.
 */
export async function replayHookSets(args: {
  page: Page;
  hookSets: Partial<Record<HookKind, StoredHookActionSet>>;
  runId: string;
  events: ReplayEventBus;
}): Promise<HookReplayOutcome> {
  const { page, hookSets, runId, events } = args;
  for (const hook of ["oneTimeSetup", "beforeEach"] as const) {
    if (events.isCancelled(runId)) {
      return { ok: false, failureMessage: "Run cancelled — recording was discarded." };
    }
    const set = hookSets[hook];
    if (!set) continue;
    try {
      await page.goto(set.startUrl, { timeout: PER_STEP_TIMEOUT_MS });
      for (const a of set.actions) {
        if (events.isCancelled(runId)) break;
        if (a.deleted || a.type === "navigate" || !a.selector) continue;
        const loc = page
          .locator(normalizeSelectorForLocator(a.selector, a.selectorStrategy))
          .first();
        if (a.type === "click") {
          await loc.click({ timeout: PER_STEP_TIMEOUT_MS });
        } else if (a.type === "fill") {
          await loc.fill(a.value ?? "", { timeout: PER_STEP_TIMEOUT_MS });
        } else if (a.type === "select") {
          await loc.selectOption(a.value ?? "", { timeout: PER_STEP_TIMEOUT_MS });
        } else if (a.type === "check") {
          await loc.check({ timeout: PER_STEP_TIMEOUT_MS });
        }
      }
    } catch (err) {
      return {
        ok: false,
        failureMessage: `Setup hook ${hook} failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  return { ok: true, failureMessage: null };
}

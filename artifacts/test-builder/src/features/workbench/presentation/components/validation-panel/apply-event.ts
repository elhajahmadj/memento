import type { ValidationStatus } from "@workspace/api-client-react";
import { describePlanStep } from "./helpers";
import type { A11yViolation, RunState, StepEvent } from "./types";

export function reduceRunEvent(
  cur: RunState,
  msg: Record<string, unknown>,
): RunState {
  const type = msg.type as string;
  const next: RunState = { ...cur, steps: [...cur.steps] };
  const upsertStep = (
    idx: number,
    patch: Partial<StepEvent> & { status: StepEvent["status"] },
  ) => {
    const existing = next.steps.find((s) => s.index === idx);
    const merged: StepEvent = {
      index: idx,
      description: existing?.description ?? `Step ${idx + 1}`,
      detail: existing?.detail,
      ...existing,
      ...patch,
      timestamp: new Date().toISOString(),
    };
    const existingIdx = next.steps.findIndex((s) => s.index === idx);
    if (existingIdx >= 0) next.steps[existingIdx] = merged;
    else next.steps.push(merged);
  };
  if (type === "run-queued") {
    next.status = "queued";
  } else if (type === "run-started") {
    next.status = "running";
    next.label = (msg.label as string) ?? cur.label;
  } else if (type === "stage") {
    const stage = msg.stage as string;
    if (stage === "reachability") {
      next.message = `Checking that ${msg.url} is reachable…`;
    } else {
      next.message = `Stage: ${stage}`;
    }
  } else if (type === "preflight") {
    next.preflight = {
      url: (msg.url as string) ?? "",
      ok: !!msg.ok,
      statusCode: msg.statusCode as number | undefined,
      error: msg.error as string | undefined,
    };
  } else if (type === "plan") {
    const planSteps =
      (msg.steps as Array<Record<string, unknown>> | undefined) ?? [];
    next.steps = planSteps.map((s, i) => ({
      index: typeof s.index === "number" ? s.index : i,
      description:
        typeof s.description === "string"
          ? s.description
          : describePlanStep(s),
      status: "pending",
      detail: typeof s.selector === "string" ? s.selector : undefined,
      timestamp: new Date().toISOString(),
    }));
  } else if (type === "step-running") {
    upsertStep(msg.index as number, { status: "running" });
  } else if (type === "step-passed") {
    upsertStep(msg.index as number, {
      status: "passed",
      detail:
        typeof msg.durationMs === "number" ? `${msg.durationMs} ms` : undefined,
    });
  } else if (type === "step-failed") {
    const detail = [
      typeof msg.error === "string" ? msg.error : null,
      typeof msg.selector === "string" ? `selector: ${msg.selector}` : null,
    ]
      .filter(Boolean)
      .join(" — ");
    // T004 — server attaches `failedAt.selector` for selector-driven
    // failures. Stash it on the step so the row can offer a "Fix
    // selector" affordance that swaps it across all recordings.
    const failedAt = msg.failedAt as
      | {
          selector?: string | null;
          source?: {
            filePath?: string | null;
            kind?: string | null;
            methodName?: string | null;
          } | null;
          stepIndex?: number | null;
        }
      | undefined;
    const failedSelector =
      (failedAt && typeof failedAt.selector === "string"
        ? failedAt.selector
        : typeof msg.selector === "string"
          ? (msg.selector as string)
          : undefined) || undefined;
    const failedAtSource =
      failedAt &&
      failedAt.source &&
      typeof failedAt.source.filePath === "string" &&
      typeof failedAt.source.kind === "string" &&
      typeof failedAt.stepIndex === "number"
        ? {
            filePath: failedAt.source.filePath,
            kind: failedAt.source.kind,
            methodName:
              typeof failedAt.source.methodName === "string"
                ? failedAt.source.methodName
                : null,
            stepIndex: failedAt.stepIndex,
          }
        : undefined;
    upsertStep(msg.index as number, {
      status: "failed",
      detail: detail || undefined,
      failedSelector,
      errorMessage:
        typeof msg.error === "string" ? (msg.error as string) : undefined,
      // T15 — server now sends a bounded DOM snippet + the live page
      // URL on step-failed so the heal dialog can ground its AI
      // suggestion and the re-pick session can navigate to the right
      // page. Either may be `null` when capture failed (e.g. browser
      // crashed before we could screenshot).
      domSnippet:
        typeof msg.domSnippet === "string"
          ? (msg.domSnippet as string)
          : undefined,
      failedPageUrl:
        typeof msg.pageUrl === "string" ? (msg.pageUrl as string) : undefined,
      failedAtSource,
    });
  } else if (type === "a11y-violations") {
    const idx = msg.stepIndex as number | undefined;
    if (typeof idx === "number") {
      const existing = next.steps.find((s) => s.index === idx);
      upsertStep(idx, {
        status: existing?.status ?? "running",
        a11y: (msg.violations as A11yViolation[]) ?? [],
      });
    }
  } else if (type === "visual-diff" || type === "visual-baseline-created") {
    const idx = msg.stepIndex as number | undefined;
    if (typeof idx === "number") {
      const existing = next.steps.find((s) => s.index === idx);
      upsertStep(idx, {
        status: existing?.status ?? "running",
        visual: {
          name: (msg.name as string) ?? "baseline",
          ratio: (msg.ratio as number) ?? 0,
          threshold: (msg.threshold as number) ?? 0,
          diffPath: (msg.diffPath as string) ?? "",
          created: type === "visual-baseline-created",
        },
      });
    }
  } else if (type === "log") {
    next.message = msg.message as string;
  } else if (type === "run-finished") {
    next.status = (msg.status as ValidationStatus) ?? "passed";
    next.finishedAt = new Date().toISOString();
    const summary = (msg.summary as Record<string, unknown>) ?? {};
    if (typeof summary.error === "string") next.message = summary.error;
    else if (typeof summary.message === "string")
      next.message = summary.message;
    if (typeof summary.durationMs === "number")
      next.durationMs = summary.durationMs;
    if (typeof summary.passedChildren === "number")
      next.passedChildren = summary.passedChildren;
    if (typeof summary.failedChildren === "number")
      next.failedChildren = summary.failedChildren;
    if (typeof summary.plannedChildren === "number")
      next.plannedChildren = summary.plannedChildren;
  }
  return next;
}

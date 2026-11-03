import { Button } from "@/shared/ui/button";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
} from "lucide-react";
import {
  validationScreenshotUrl,
  validationTraceUrl,
} from "@workspace/api-client-react";
import { RunStatusBadge } from "./run-status-badge";
import { StepRow } from "./step-row";
import type { RunState, StepEvent } from "./types";
import type { FixSelectorContext } from "../../dialogs/fix-selector/types";

export function RunRow({
  run,
  onFixSelector,
}: {
  run: RunState;
  onFixSelector: (
    ctx: FixSelectorContext,
    initialTab?: import("../../dialogs/fix-selector/types").FixSelectorInitialTab,
  ) => void;
}) {
  // Build the context for the heal dialog: include the failing step's
  // description + error, the page URL preflight resolved, and the
  // sequence of step descriptions leading up to (but not including) the
  // failing one. The AI use case uses this to ground its suggestion.
  const buildContext = (step: StepEvent): FixSelectorContext => {
    const priorSteps = run.steps
      .filter((s) => s.index < step.index)
      .map((s) => s.description);
    return {
      selector: step.failedSelector!,
      errorMessage: step.errorMessage ?? step.detail,
      actionDescription: step.description,
      // Prefer the live URL the page was on when the step failed
      // (captured by the validation runner) over the preflight URL —
      // those differ once the recording navigates.
      pageUrl: step.failedPageUrl ?? run.preflight?.url,
      domSnippet: step.domSnippet,
      priorSteps,
      source: step.failedAtSource,
    };
  };

  return (
    <li className="p-3" data-testid={`run-${run.id}`}>
      <div className="flex items-center gap-2">
        <RunStatusBadge status={run.status} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{run.label}</div>
          <div className="text-xs text-muted-foreground font-mono truncate">
            {run.id}
          </div>
        </div>
        {run.status === "passed" || run.status === "failed" ? (
          <>
            <a
              href={validationScreenshotUrl(run.id)}
              target="_blank"
              rel="noreferrer"
              title="Final screenshot"
            >
              <Button size="sm" variant="ghost">
                <Camera className="h-3 w-3" />
              </Button>
            </a>
            <a
              href={validationTraceUrl(run.id)}
              title="Download Playwright trace"
            >
              <Button size="sm" variant="ghost">
                <Download className="h-3 w-3" />
              </Button>
            </a>
          </>
        ) : null}
      </div>

      {run.preflight && (
        <div className="mt-2 text-xs">
          {run.preflight.ok ? (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Reachable:{" "}
              {run.preflight.url}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-3 w-3" /> Unreachable:{" "}
              {run.preflight.url}{" "}
              {run.preflight.statusCode ??
                run.preflight.error ??
                "no response"}
            </span>
          )}
        </div>
      )}

      {run.steps.length > 0 && (
        <ol className="mt-2 space-y-1">
          {run.steps.map((s) => (
            <StepRow
              key={s.index}
              runId={run.id}
              step={s}
              onFixSelector={onFixSelector}
              buildContext={buildContext}
            />
          ))}
        </ol>
      )}
      {run.message && (
        <div className="mt-2 text-xs text-muted-foreground">{run.message}</div>
      )}
      {(run.status === "passed" ||
        run.status === "failed" ||
        run.status === "error") &&
        (typeof run.durationMs === "number" ||
          typeof run.plannedChildren === "number") && (
          <div
            className="mt-1 text-xs text-muted-foreground"
            data-testid={`run-${run.id}-summary`}
          >
            {typeof run.durationMs === "number" &&
              `Duration: ${(run.durationMs / 1000).toFixed(2)}s`}
            {typeof run.plannedChildren === "number" && (
              <>
                {typeof run.durationMs === "number" ? " • " : ""}
                {run.passedChildren ?? 0} passed,{" "}
                {run.failedChildren ?? 0} failed of {run.plannedChildren}
              </>
            )}
          </div>
        )}
    </li>
  );
}

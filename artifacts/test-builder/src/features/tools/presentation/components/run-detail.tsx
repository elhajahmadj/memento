import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  CheckCircle2,
  Download,
  Loader2,
  XCircle,
} from "lucide-react";
import {
  getValidationRun,
  validationScreenshotUrl,
  validationTraceUrl,
} from "@workspace/api-client-react";
import {
  describeStep,
  type RunStep,
  type RunSummary,
} from "@/features/tools/domain/validation-run-rules";

function StepIcon({ status }: { status: RunStep["status"] }) {
  if (status === "passed")
    return <CheckCircle2 className="h-3 w-3 text-emerald-600 mt-0.5" />;
  if (status === "failed")
    return <XCircle className="h-3 w-3 text-red-600 mt-0.5" />;
  if (status === "running")
    return <Loader2 className="h-3 w-3 animate-spin mt-0.5" />;
  if (status === "skipped")
    return <span className="h-3 w-3 mt-0.5 text-muted-foreground">›</span>;
  return <span className="h-3 w-3 mt-0.5 text-muted-foreground">·</span>;
}

/**
 * Per-run drilldown that fetches the full run row (including
 * `summary.steps`) on demand and renders a step-by-step report with
 * the final-state screenshot and trace download. Mirrors the live
 * `ValidationPanel` layout so the historical view feels familiar.
 */
export function RunDetail({ runId }: { runId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["validation-run", runId],
    queryFn: () => getValidationRun(runId),
    staleTime: 10_000,
  });
  if (isLoading) {
    return (
      <div
        className="flex items-center text-xs text-muted-foreground"
        data-testid={`text-run-detail-loading-${runId}`}
      >
        <Loader2 className="h-3 w-3 mr-2 animate-spin" /> Loading run details…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div
        className="text-xs text-destructive"
        data-testid={`text-run-detail-error-${runId}`}
      >
        Failed to load run details.
      </div>
    );
  }
  const summary = (data.summary ?? {}) as RunSummary;
  const steps = Array.isArray(summary.steps) ? summary.steps : [];
  const screenshotAvailable = Boolean(summary.finalScreenshot);
  const traceAvailable = Boolean(data.traceRef);
  const isParent =
    typeof summary.plannedChildren === "number" && steps.length === 0;
  return (
    <div className="mt-2 border-t pt-3 text-xs space-y-2">
      <div className="flex items-center gap-3 text-muted-foreground">
        <span data-testid={`text-run-detail-id-${runId}`}>
          Run <span className="font-mono">{runId}</span>
        </span>
        {typeof summary.durationMs === "number" && (
          <span>· {(summary.durationMs / 1000).toFixed(2)}s</span>
        )}
      </div>
      {summary.failureMessage && (
        <div
          className="text-destructive font-mono whitespace-pre-wrap break-words"
          data-testid={`text-run-detail-failure-${runId}`}
        >
          {summary.failureMessage}
        </div>
      )}
      {summary.error && !summary.failureMessage && (
        <div
          className="text-destructive font-mono whitespace-pre-wrap break-words"
          data-testid={`text-run-detail-error-msg-${runId}`}
        >
          {summary.error}
        </div>
      )}
      {isParent ? (
        <div data-testid={`text-run-detail-parent-${runId}`}>
          {summary.passedChildren ?? 0} passed,{" "}
          {summary.failedChildren ?? 0} failed,{" "}
          {summary.erroredChildren ?? 0} errored of{" "}
          {summary.plannedChildren ?? 0} child runs.
        </div>
      ) : steps.length > 0 ? (
        <ol
          className="space-y-1 font-mono"
          data-testid={`list-run-detail-steps-${runId}`}
        >
          {steps.map((s) => (
            <li
              key={s.index}
              className="flex items-start gap-2"
              data-testid={`row-run-detail-step-${runId}-${s.index}`}
            >
              <StepIcon status={s.status} />
              <span className="flex-1 min-w-0">
                <span className="text-muted-foreground">#{s.index + 1}</span>{" "}
                {describeStep(s)}
                {typeof s.durationMs === "number" && (
                  <span className="text-muted-foreground">
                    {" "}
                    ({s.durationMs}ms)
                  </span>
                )}
                {s.error && (
                  <span className="block text-destructive break-words">
                    {s.error}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="text-muted-foreground">
          No step-level results recorded for this run.
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        {screenshotAvailable && (
          <a
            href={validationScreenshotUrl(runId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover-elevate px-2 py-1 rounded-sm"
            data-testid={`link-run-detail-screenshot-${runId}`}
          >
            <Camera className="h-3 w-3" />
            Final screenshot
          </a>
        )}
        {traceAvailable && (
          <a
            href={validationTraceUrl(runId)}
            className="inline-flex items-center gap-1 text-primary hover-elevate px-2 py-1 rounded-sm"
            data-testid={`link-run-detail-trace-${runId}`}
          >
            <Download className="h-3 w-3" />
            Download trace
          </a>
        )}
        {!screenshotAvailable && !traceAvailable && (
          <span className="text-muted-foreground">
            No artifacts produced for this run.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * <ToolsSelectionRun /> — run-detail surface for a selection-based
 * dispatch (the "Run selected" button on the workbench Tests tree).
 *
 * Polls `GET /api/projects/:projectId/runs/by-selection/:runId` every
 * second while the run is still in flight (`finishedAt` null), then
 * stops once the dispatcher reports a terminal status. Renders live
 * status, exit code, the captured stdout / stderr in a scrollable
 * monospace panel, and any infrastructure-level error message.
 *
 * Routed at `/tools/selection-runs/:projectId/:runId` — `:projectId`
 * is the URL-encoded `slnPath` (matches the dispatch endpoint param)
 * and `:runId` is the id returned in the dispatch response.
 */
import { useMemo } from "react";
import { useParams } from "wouter";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ListChecks,
} from "lucide-react";
import {
  useGetProjectSelectionRun,
  getGetProjectSelectionRunQueryKey,
  type SelectionRunDetail,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { PageShell } from "@/shared/ui/shell/page-shell";

function statusBadge(status: SelectionRunDetail["status"]) {
  switch (status) {
    case "passed":
      return (
        <Badge
          variant="outline"
          className="text-emerald-600 border-emerald-600/40"
          data-testid="badge-selection-run-status"
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Passed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" data-testid="badge-selection-run-status">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case "error":
      return (
        <Badge
          variant="destructive"
          className="opacity-80"
          data-testid="badge-selection-run-status"
        >
          <AlertTriangle className="h-3 w-3 mr-1" />
          Error
        </Badge>
      );
    case "running":
    default:
      return (
        <Badge
          variant="outline"
          className="text-amber-600 border-amber-600/40"
          data-testid="badge-selection-run-status"
        >
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Running
        </Badge>
      );
  }
}

function fmtDuration(start: string, end: string | null): string {
  const endMs = end ? new Date(end).getTime() : Date.now();
  const ms = endMs - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function ToolsSelectionRun() {
  // wouter URL-decodes path params; the dispatch URL was built with
  // encodeURIComponent so `slnPath`'s slashes round-trip correctly.
  const params = useParams<{ projectId?: string; runId?: string }>();
  const projectId = params.projectId ?? "";
  const runId = params.runId ?? "";

  const { data, error, isLoading, isFetching, refetch } =
    useGetProjectSelectionRun(projectId, runId, {
      query: {
        enabled: !!projectId && !!runId,
        queryKey: getGetProjectSelectionRunQueryKey(projectId, runId),
        // Poll until the dispatcher marks the run finished. Once
        // `finishedAt` is set the status is terminal and further polls
        // would be wasted requests.
        refetchInterval: (query) => {
          const d = query.state.data as SelectionRunDetail | undefined;
          if (!d) return 1000;
          return d.finishedAt ? false : 1000;
        },
        refetchIntervalInBackground: false,
      },
    });

  const decodedProject = useMemo(() => {
    try {
      return decodeURIComponent(projectId);
    } catch {
      return projectId;
    }
  }, [projectId]);

  const finished = data ? data.finishedAt !== null : false;

  return (
    <PageShell
      contentClassName="max-w-5xl"
      backTestId="button-selection-run-back"
      backTo="/workbench"
      backLabel="Back to Workbench"
    >
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold mb-1 flex items-center gap-2">
            <ListChecks className="h-6 w-6 text-primary" />
            Selection run
          </h1>
          <p
            className="text-muted-foreground text-sm font-mono truncate"
            data-testid="text-selection-run-project"
            title={decodedProject}
          >
            {decodedProject || "(no project)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && statusBadge(data.status)}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-selection-run-refresh"
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div
          className="flex items-center text-muted-foreground"
          data-testid="text-selection-run-loading"
        >
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading run…
        </div>
      ) : error || !data ? (
        <Card data-testid="card-selection-run-error">
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load this run. It may have expired (the dispatcher
            keeps runs in memory only) or the URL may be wrong.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card data-testid="card-selection-run-meta">
            <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground uppercase tracking-wide font-mono text-[10px]">
                  Run id
                </div>
                <div
                  className="font-mono break-all"
                  data-testid="text-selection-run-id"
                >
                  {data.id}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground uppercase tracking-wide font-mono text-[10px]">
                  Suite
                </div>
                <div data-testid="text-selection-run-suite">
                  {data.suiteName}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground uppercase tracking-wide font-mono text-[10px]">
                  Duration
                </div>
                <div data-testid="text-selection-run-duration">
                  {fmtDuration(data.startedAt, data.finishedAt)}
                  {!finished ? " (running…)" : ""}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground uppercase tracking-wide font-mono text-[10px]">
                  Exit code
                </div>
                <div data-testid="text-selection-run-exit-code">
                  {data.exitCode === null ? "—" : data.exitCode}
                </div>
              </div>
            </CardContent>
          </Card>

          {data.errorMessage && (
            <Card data-testid="card-selection-run-error-message">
              <CardContent className="p-4 text-xs">
                <div className="text-muted-foreground uppercase tracking-wide font-mono text-[10px] mb-1">
                  Dispatcher error
                </div>
                <pre
                  className="text-destructive font-mono whitespace-pre-wrap break-words"
                  data-testid="text-selection-run-error-message"
                >
                  {data.errorMessage}
                </pre>
              </CardContent>
            </Card>
          )}

          <OutputPanel
            label="stdout"
            text={data.stdout}
            testId="selection-run-stdout"
          />
          <OutputPanel
            label="stderr"
            text={data.stderr}
            testId="selection-run-stderr"
            errorTone
          />
        </div>
      )}
    </PageShell>
  );
}

function OutputPanel({
  label,
  text,
  testId,
  errorTone = false,
}: {
  label: string;
  text: string;
  testId: string;
  errorTone?: boolean;
}) {
  const empty = text.length === 0;
  return (
    <Card data-testid={`card-${testId}`}>
      <CardContent className="p-0">
        <div className="px-4 py-2 border-b text-[10px] uppercase tracking-wide font-mono text-muted-foreground flex items-center justify-between">
          <span>{label}</span>
          {!empty && (
            <span data-testid={`text-${testId}-bytes`}>
              {text.length.toLocaleString()} bytes
            </span>
          )}
        </div>
        {empty ? (
          <div
            className="px-4 py-3 text-xs text-muted-foreground"
            data-testid={`text-${testId}-empty`}
          >
            No {label} captured yet.
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <pre
              className={
                "p-4 text-xs font-mono whitespace-pre-wrap break-words " +
                (errorTone ? "text-destructive" : "")
              }
              data-testid={`text-${testId}`}
            >
              {text}
            </pre>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

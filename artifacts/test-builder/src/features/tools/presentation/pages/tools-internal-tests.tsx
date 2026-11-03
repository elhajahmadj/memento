import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
} from "lucide-react";
import {
  useListInternalTestSuites,
  useStartInternalTestRun,
  useGetInternalTestRun,
  getListInternalTestSuitesQueryKey,
  getGetInternalTestRunQueryKey,
  ApiError,
  type InternalTestRun,
  type InternalTestRunConflict,
  type InternalTestSuiteDescriptor,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { useIsAdmin } from "@/features/auth/presentation/role";
import {
  SwitchOrgGatePage,
  useSwitchOrgGate,
} from "@/features/auth/presentation/switch-org-gate";

const MAX_LOG_LINES_RENDERED = 5000;

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

function StatusBadge({ status }: { status: InternalTestRun["status"] }) {
  if (status === "running") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-blue-500/40 text-blue-600 dark:text-blue-400"
        data-testid="badge-internal-tests-status-running"
      >
        <Loader2 className="h-3 w-3 animate-spin" /> Running
      </Badge>
    );
  }
  if (status === "passed") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
        data-testid="badge-internal-tests-status-passed"
      >
        <CheckCircle2 className="h-3 w-3" /> Passed
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-red-500/40 text-red-600 dark:text-red-400"
        data-testid="badge-internal-tests-status-failed"
      >
        <XCircle className="h-3 w-3" /> Failed
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
      data-testid="badge-internal-tests-status-error"
    >
      <AlertTriangle className="h-3 w-3" /> Error
    </Badge>
  );
}

interface RunStreamState {
  run: InternalTestRun | null;
  log: string[];
  done: boolean;
  error: string | null;
}

const EMPTY_STATE: RunStreamState = { run: null, log: [], done: true, error: null };

export function ToolsInternalTests() {
  const isAdmin = useIsAdmin();
  const { canPromptSwitch } = useSwitchOrgGate({
    allowed: isAdmin,
    requires: "admin",
    pageLabel: "Internal tests",
    toastMessage: "You don't have access to Tools",
  });
  const queryClient = useQueryClient();

  const suitesQueryKey = getListInternalTestSuitesQueryKey();
  const {
    data: suitesData,
    isLoading: suitesLoading,
    isFetching: suitesFetching,
    refetch: refetchSuites,
  } = useListInternalTestSuites({
    query: { queryKey: suitesQueryKey, enabled: isAdmin },
  });

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [stream, setStream] = useState<RunStreamState>(EMPTY_STATE);
  const consoleRef = useRef<HTMLPreElement>(null);
  const autoScrollRef = useRef(true);

  // Hydrate from a server-side current run on first load (e.g. user
  // refreshed the page mid-run started by another tab/admin).
  useEffect(() => {
    if (suitesData?.current && !activeRunId) {
      setActiveRunId(suitesData.current.id);
      setStream({
        run: suitesData.current,
        log: [],
        done: suitesData.current.status !== "running",
        error: null,
      });
    }
  }, [suitesData, activeRunId]);

  // If we have an activeRunId but no live SSE (because it was hydrated
  // from "current"), fetch the captured log once so users see history.
  const runLogQueryKey = getGetInternalTestRunQueryKey(activeRunId ?? "");
  const { data: runWithLog } = useGetInternalTestRun(activeRunId ?? "", {
    query: {
      queryKey: runLogQueryKey,
      enabled: Boolean(
        activeRunId && stream.log.length === 0 && stream.run?.status !== "running",
      ),
    },
  });
  useEffect(() => {
    if (runWithLog && stream.log.length === 0) {
      setStream((s) => ({
        ...s,
        run: runWithLog.run,
        log: runWithLog.log,
        done: runWithLog.run.status !== "running",
      }));
    }
  }, [runWithLog, stream.log.length]);

  // SSE subscription tied to activeRunId.
  useEffect(() => {
    if (!activeRunId || !isAdmin) return;
    if (stream.done) return;
    const url = `/api/admin/internal-tests/runs/${encodeURIComponent(activeRunId)}/stream`;
    const es = new EventSource(url, { withCredentials: true });
    const onLog = (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(evt.data) as { line: string };
        setStream((s) => {
          const nextLog = s.log.concat(payload.line);
          if (nextLog.length > MAX_LOG_LINES_RENDERED) {
            nextLog.splice(0, nextLog.length - MAX_LOG_LINES_RENDERED);
          }
          return { ...s, log: nextLog };
        });
      } catch {
        /* ignore malformed line */
      }
    };
    const onDone = (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(evt.data) as { run: InternalTestRun };
        setStream((s) => ({ ...s, run: payload.run, done: true }));
        void queryClient.invalidateQueries({ queryKey: suitesQueryKey });
      } catch {
        /* ignore */
      }
    };
    const onError = () => {
      setStream((s) => ({ ...s, error: "Connection lost" }));
      es.close();
    };
    es.addEventListener("log", onLog);
    es.addEventListener("done", onDone);
    es.addEventListener("error", onError);
    return () => {
      es.removeEventListener("log", onLog);
      es.removeEventListener("done", onDone);
      es.removeEventListener("error", onError);
      es.close();
    };
  }, [activeRunId, isAdmin, stream.done, queryClient, suitesQueryKey]);

  // Auto-scroll the console to the bottom unless the user scrolled up.
  useEffect(() => {
    const el = consoleRef.current;
    if (!el || !autoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [stream.log]);

  const handleConsoleScroll = useCallback(() => {
    const el = consoleRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    autoScrollRef.current = distanceFromBottom < 32;
  }, []);

  const startRunMutation = useStartInternalTestRun({
    mutation: {
      onSuccess: (data) => {
        setActiveRunId(data.run.id);
        setStream({ run: data.run, log: [], done: false, error: null });
        autoScrollRef.current = true;
        void queryClient.invalidateQueries({ queryKey: suitesQueryKey });
      },
      onError: (err: unknown) => {
        // The shared customFetch throws ApiError with `status` + `data`,
        // not an axios-style `{ response: { status, data } }` envelope.
        if (err instanceof ApiError) {
          const data = err.data as
            | { error?: string; run?: InternalTestRun }
            | InternalTestRunConflict
            | null;
          if (err.status === 409 && data && "run" in data && data.run) {
            // Another run is already active — adopt it instead of erroring.
            const other = data.run;
            setActiveRunId(other.id);
            setStream({
              run: other,
              log: [],
              done: other.status !== "running",
              error: null,
            });
            toast.info("Another test run is already in progress — showing it instead.");
            return;
          }
          const msg =
            (data && "error" in data && data.error) || err.message || "Failed to start test run";
          toast.error(msg);
          return;
        }
        toast.error("Failed to start test run");
      },
    },
  });

  const isAnotherRunActive = Boolean(
    suitesData?.current && suitesData.current.id !== activeRunId,
  );
  const currentRunInProgress =
    Boolean(suitesData?.current) || (stream.run?.status === "running");

  const summary = stream.run?.summary;
  const status = stream.run?.status;

  const suites: InternalTestSuiteDescriptor[] = useMemo(
    () => suitesData?.suites ?? [],
    [suitesData],
  );

  if (!isAdmin) {
    if (!canPromptSwitch) return null;
    return (
      <SwitchOrgGatePage
        pageLabel="Internal tests"
        description="Run the api-server vitest suites without leaving the workspace."
        requires="admin"
        testId="internal-tests-switch-org-prompt"
        contentClassName="max-w-5xl"
        backTestId="button-internal-tests-back"
        backTo="/tools"
        backLabel="Back to Tools"
      />
    );
  }

  return (
    <PageShell
      contentClassName="max-w-5xl"
      backTestId="button-internal-tests-back"
      backTo="/tools"
      backLabel="Back to Tools"
    >
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold mb-1 flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-primary" /> Internal tests
          </h1>
          <p className="text-muted-foreground">
            Run the api-server vitest suites without leaving the workspace.
            Output streams live; only one run is allowed at a time.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchSuites()}
          disabled={suitesFetching}
          data-testid="button-internal-tests-refresh"
        >
          {suitesFetching ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-1" />
          )}
          Refresh
        </Button>
      </div>

      {suitesLoading ? (
        <div
          className="flex items-center text-muted-foreground"
          data-testid="text-internal-tests-loading"
        >
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
        </div>
      ) : suitesData && !suitesData.enabled ? (
        <Card data-testid="card-internal-tests-disabled">
          <CardContent className="p-6 text-sm text-muted-foreground">
            The internal test runner is disabled in this environment because
            the workspace source tree is not available (typical for the
            production bundle).
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="space-y-3" data-testid="container-internal-tests-suites">
            {suites.map((suite) => {
              const startingThis =
                startRunMutation.isPending &&
                startRunMutation.variables?.data.suiteKey === suite.key;
              return (
                <Card
                  key={suite.key}
                  data-testid={`card-internal-tests-suite-${suite.key}`}
                >
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold">{suite.name}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {suite.description}
                    </p>
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={currentRunInProgress || startRunMutation.isPending}
                      onClick={() =>
                        startRunMutation.mutate({ data: { suiteKey: suite.key } })
                      }
                      data-testid={`button-internal-tests-run-${suite.key}`}
                    >
                      {startingThis ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4 mr-1" />
                      )}
                      Run
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
            {isAnotherRunActive ? (
              <p
                className="text-xs text-amber-600 dark:text-amber-400"
                data-testid="text-internal-tests-other-run"
              >
                Another admin started a run. Watching it below.
              </p>
            ) : null}
          </div>

          <Card className="flex flex-col" data-testid="card-internal-tests-console">
            <CardContent className="p-4 flex-1 flex flex-col gap-3 min-h-0">
              <div className="flex flex-wrap items-center gap-3">
                {stream.run ? (
                  <>
                    <StatusBadge status={stream.run.status} />
                    <span
                      className="text-sm font-medium"
                      data-testid="text-internal-tests-run-suite"
                    >
                      {stream.run.suiteName}
                    </span>
                    {summary ? (
                      <>
                        <Badge
                          variant="secondary"
                          className="gap-1"
                          data-testid="badge-internal-tests-summary-passed"
                        >
                          <CheckCircle2 className="h-3 w-3" />{" "}
                          {summary.numPassedTests} passed
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="gap-1"
                          data-testid="badge-internal-tests-summary-failed"
                        >
                          <XCircle className="h-3 w-3" />{" "}
                          {summary.numFailedTests} failed
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="gap-1"
                          data-testid="badge-internal-tests-summary-total"
                        >
                          {summary.numTotalTests} total
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="gap-1"
                          data-testid="badge-internal-tests-summary-duration"
                        >
                          <Clock className="h-3 w-3" />{" "}
                          {formatDurationMs(summary.durationMs)}
                        </Badge>
                      </>
                    ) : null}
                    {status === "error" && stream.run.errorMessage ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        {stream.run.errorMessage}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Pick a suite on the left and press Run to see live output here.
                  </span>
                )}
              </div>
              <pre
                ref={consoleRef}
                onScroll={handleConsoleScroll}
                className="flex-1 min-h-[360px] max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap"
                data-testid="text-internal-tests-console"
              >
                {stream.log.length === 0
                  ? "(no output yet)"
                  : stream.log.join("\n")}
              </pre>
              {stream.error ? (
                <p
                  className="text-xs text-destructive"
                  data-testid="text-internal-tests-stream-error"
                >
                  {stream.error}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}

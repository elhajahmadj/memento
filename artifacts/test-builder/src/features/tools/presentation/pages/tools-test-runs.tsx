import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { ListChecks, Loader2, Play, RefreshCw, Sparkles } from "lucide-react";
import {
  listValidationRuns,
  startValidateAll,
  useGetCurrentProject,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { useIsAnyAdmin } from "@/features/auth/presentation/role";
import { SummarizeSuiteDialog } from "@/features/tools/presentation/components/summarize-suite-dialog";
import {
  SwitchOrgGatePage,
  useSwitchOrgGate,
} from "@/features/auth/presentation/switch-org-gate";
import {
  HISTORY_PAGE_SIZE,
  summarizeByTest,
} from "@/features/tools/domain/validation-run-rules";
import { RunHistoryList } from "@/features/tools/presentation/components/run-history-list";
import { PerTestTrends } from "@/features/tools/presentation/components/per-test-trends";

const RUNS_QUERY_KEY = ["validation-runs"] as const;

export function ToolsTestRuns() {
  const isAnyAdmin = useIsAnyAdmin();
  const { canPromptSwitch } = useSwitchOrgGate({
    allowed: isAnyAdmin,
    requires: "anyAdmin",
    pageLabel: "Test runs",
    toastMessage: "You don't have access to Tools",
  });
  // Drilldown panels expand inline below their row. Multiple can be
  // open at once because users often want to compare a recent failure
  // against the previous pass.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Pagination cursor for the run history table — only `visibleCount`
  // of the most-recent runs render at a time. The "Show more" button
  // grows this in HISTORY_PAGE_SIZE chunks.
  const [visibleCount, setVisibleCount] = useState<number>(HISTORY_PAGE_SIZE);
  const [summarizeOpen, setSummarizeOpen] = useState(false);
  const { data: currentProject } = useGetCurrentProject();

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: RUNS_QUERY_KEY,
    queryFn: listValidationRuns,
    enabled: isAnyAdmin,
    refetchInterval: 5_000,
  });

  // The API already returns runs newest-first; keep that ordering for
  // the chronological "Run history" table at the top of the page.
  const orderedRuns = useMemo(() => data ?? [], [data]);
  const visibleRuns = useMemo(
    () => orderedRuns.slice(0, visibleCount),
    [orderedRuns, visibleCount],
  );
  const hasMore = orderedRuns.length > visibleCount;
  const groups = useMemo(() => summarizeByTest(data ?? []), [data]);
  // Per-test names for the suite-summary AI assist. The validation
  // runs API returns one entry per (file, method) so we de-dupe via
  // `summarizeByTest` and pull the method name (falling back to the
  // file basename for runs that have no method).
  const suiteTestNames = useMemo(
    () =>
      Array.from(
        new Set(
          groups
            .map(
              (g) =>
                g.methodName ??
                (g.filePath.split("/").pop() ?? g.filePath),
            )
            .filter((s): s is string => !!s && s !== "(unknown)"),
        ),
      ),
    [groups],
  );

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRunAll = async () => {
    try {
      await startValidateAll();
      toast.success("Validate all queued");
      void refetch();
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to start run");
    }
  };

  if (!isAnyAdmin) {
    if (!canPromptSwitch) return null;
    return (
      <SwitchOrgGatePage
        pageLabel="Test runs"
        description="Browse the validation run history for this project."
        requires="anyAdmin"
        testId="test-runs-switch-org-prompt"
        contentClassName="max-w-5xl"
        backTestId="button-test-runs-back"
        backTo="/tools"
        backLabel="Back to Tools"
      />
    );
  }

  return (
    <PageShell
      contentClassName="max-w-5xl"
      backTestId="button-test-runs-back"
      backTo="/tools"
      backLabel="Back to Tools"
    >
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold mb-1 flex items-center gap-2">
            <ListChecks className="h-6 w-6 text-primary" />
            Test runs
          </h1>
          <p className="text-muted-foreground">
            Newest-first history of the last 50 validation runs for
            this project. Expand any row to see step-by-step results,
            the final screenshot, and the Playwright trace. Per-test
            pass-rate and flakiness summarise the last 30 days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSummarizeOpen(true)}
            disabled={suiteTestNames.length === 0}
            title={
              suiteTestNames.length === 0
                ? "No tests found yet for this project."
                : "Explain this suite in plain English (AI)"
            }
            data-testid="button-test-runs-summarize"
          >
            <Sparkles className="h-4 w-4 mr-1" />
            Summarize
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleRunAll}
            data-testid="button-test-runs-run-all"
          >
            <Play className="h-4 w-4 mr-1 fill-current" />
            Run all tests
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-test-runs-refresh"
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
          data-testid="text-test-runs-loading"
        >
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="text-destructive" data-testid="text-test-runs-error">
          Failed to load test runs.
        </div>
      ) : orderedRuns.length === 0 ? (
        <Card data-testid="card-test-runs-empty">
          <CardContent className="p-8 text-center text-muted-foreground">
            No validation runs yet for this project. Trigger a run from
            the workbench to see it appear here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <RunHistoryList
            visibleRuns={visibleRuns}
            totalRuns={orderedRuns.length}
            hasMore={hasMore}
            expanded={expanded}
            onToggle={toggleExpanded}
            onShowMore={() =>
              setVisibleCount((c) => c + HISTORY_PAGE_SIZE)
            }
          />
          <PerTestTrends groups={groups} />
        </div>
      )}
      <SummarizeSuiteDialog
        open={summarizeOpen}
        onOpenChange={setSummarizeOpen}
        projectName={currentProject?.project?.solutionName ?? ""}
        testNames={suiteTestNames}
      />
    </PageShell>
  );
}

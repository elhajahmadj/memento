import { HardDrive, Loader2, RefreshCw } from "lucide-react";
import {
  useGetValidationTraceStats,
  getGetValidationTraceStatsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { useIsAdmin } from "@/features/auth/presentation/role";
import {
  SwitchOrgGatePage,
  useSwitchOrgGate,
} from "@/features/auth/presentation/switch-org-gate";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function formatDuration(ms: number): string {
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.round(ms / (60 * 60 * 1000));
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export function ToolsValidationTraces() {
  const isAdmin = useIsAdmin();
  const { canPromptSwitch } = useSwitchOrgGate({
    allowed: isAdmin,
    requires: "admin",
    pageLabel: "Validation traces",
    toastMessage: "You don't have access to Tools",
  });

  const queryKey = getGetValidationTraceStatsQueryKey();
  const { data, isLoading, isFetching, refetch, error } =
    useGetValidationTraceStats({
      query: { queryKey, enabled: isAdmin },
    });

  if (!isAdmin) {
    if (!canPromptSwitch) return null;
    return (
      <SwitchOrgGatePage
        pageLabel="Validation traces"
        description="Disk usage of the validation trace zips and screenshots that Playwright produces during validation runs."
        requires="admin"
        testId="validation-traces-switch-org-prompt"
        contentClassName="max-w-3xl"
        backTestId="button-validation-traces-back"
        backTo="/tools"
        backLabel="Back to Tools"
      />
    );
  }

  return (
    <PageShell
      contentClassName="max-w-3xl"
      backTestId="button-validation-traces-back"
      backTo="/tools"
      backLabel="Back to Tools"
    >
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold mb-1 flex items-center gap-2">
            <HardDrive className="h-6 w-6 text-primary" /> Validation traces
          </h1>
          <p className="text-muted-foreground">
            Disk usage of the validation trace zips and screenshots that
            Playwright produces during validation runs. The cleanup job sweeps
            files older than the retention window automatically.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-validation-traces-refresh"
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-1" />
          )}
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div
          className="flex items-center text-muted-foreground"
          data-testid="text-validation-traces-loading"
        >
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div
          className="text-destructive"
          data-testid="text-validation-traces-error"
        >
          Failed to load validation trace stats.
        </div>
      ) : data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card data-testid="card-validation-traces-disk">
            <CardContent className="p-6">
              <div className="text-sm text-muted-foreground mb-1">
                Disk used
              </div>
              <div
                className="text-3xl font-semibold tabular-nums"
                data-testid="text-validation-traces-size"
              >
                {formatBytes(data.totalBytes)}
              </div>
              <div
                className="text-sm text-muted-foreground mt-2"
                data-testid="text-validation-traces-count"
              >
                {data.fileCount} file{data.fileCount === 1 ? "" : "s"} on disk
              </div>
              <div
                className="text-xs text-muted-foreground mt-3 break-all"
                data-testid="text-validation-traces-dir"
              >
                {data.dir}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Retention: {formatDuration(data.maxAgeMs)}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-validation-traces-cleanup">
            <CardContent className="p-6">
              <div className="text-sm text-muted-foreground mb-1">
                Last cleanup run
              </div>
              {data.lastCleanup ? (
                <>
                  <div
                    className="text-lg font-medium"
                    data-testid="text-validation-traces-last-cleanup-at"
                  >
                    {new Date(data.lastCleanup.finishedAt).toLocaleString()}
                  </div>
                  <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Files deleted</dt>
                      <dd
                        className="font-medium tabular-nums"
                        data-testid="text-validation-traces-files-deleted"
                      >
                        {data.lastCleanup.filesDeleted}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Rows cleared</dt>
                      <dd
                        className="font-medium tabular-nums"
                        data-testid="text-validation-traces-rows-cleared"
                      >
                        {data.lastCleanup.rowsCleared}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <div
                  className="text-sm text-muted-foreground"
                  data-testid="text-validation-traces-no-cleanup"
                >
                  No cleanup has run since the server started.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </PageShell>
  );
}

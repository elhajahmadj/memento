import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  useListAiAgentKeys,
  useCheckAiAgentKey,
  getListAiAgentKeysQueryKey,
  type AiAgentKey,
  type AiAgentKeyCheckResult,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { CHECK_ALL_CONCURRENCY } from "./constants";
import { formatRelative, trimDetail } from "./helpers";
import { PROVIDER_SHORT_LABEL } from "./providers";
import type { AiProvider } from "./types";

type RowStatus = "idle" | "checking" | "ok" | "failing";

interface RowState {
  status: RowStatus;
  message: string | null;
  reason: string | null;
  retryAfterSeconds: number | null;
  checkedAt: number | null;
  expanded: boolean;
}

const INITIAL_ROW: RowState = {
  status: "idle",
  message: null,
  reason: null,
  retryAfterSeconds: null,
  checkedAt: null,
  expanded: false,
};

export function ApiKeyStatusSection() {
  const listKey = getListAiAgentKeysQueryKey();
  const { data, isLoading } = useListAiAgentKeys({
    query: { queryKey: listKey },
  });
  const checkMutation = useCheckAiAgentKey();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [checkingAll, setCheckingAll] = useState(false);

  const keys = useMemo<AiAgentKey[]>(
    () =>
      [...(data?.keys ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [data],
  );

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? INITIAL_ROW), ...patch },
    }));
  }

  async function runCheck(id: string): Promise<void> {
    updateRow(id, {
      status: "checking",
      message: null,
      reason: null,
      retryAfterSeconds: null,
    });
    try {
      const result: AiAgentKeyCheckResult = await checkMutation.mutateAsync({
        id,
      });
      updateRow(id, {
        status: result.ok ? "ok" : "failing",
        message: result.message,
        reason: result.reason,
        retryAfterSeconds: result.retryAfterSeconds,
        checkedAt: Date.now(),
      });
    } catch (err) {
      updateRow(id, {
        status: "failing",
        message: (err as Error)?.message ?? "Request failed",
        reason: "other",
        retryAfterSeconds: null,
        checkedAt: Date.now(),
      });
    }
  }

  async function runCheckAll() {
    if (checkingAll || keys.length === 0) return;
    setCheckingAll(true);
    try {
      const queue = [...keys];
      const workers = Array.from(
        { length: Math.min(CHECK_ALL_CONCURRENCY, queue.length) },
        async () => {
          while (queue.length > 0) {
            const next = queue.shift();
            if (!next) return;
            await runCheck(next.id);
          }
        },
      );
      await Promise.all(workers);
    } finally {
      setCheckingAll(false);
    }
  }

  return (
    <Card className="mt-4" data-testid="card-ai-key-status">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">API Key Status</h2>
            <p className="text-sm text-muted-foreground">
              Live verify each saved key against its provider. Results are
              session-only — refreshing the page resets every row to
              “Not checked”.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={isLoading || checkingAll || keys.length === 0}
            onClick={runCheckAll}
            data-testid="button-check-all-ai-keys"
          >
            {checkingAll ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Check all
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading keys…
          </div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No API keys saved yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {keys.map((k) => {
              const r = rows[k.id] ?? INITIAL_ROW;
              return (
                <li
                  key={k.id}
                  className="border rounded-md px-3 py-2"
                  data-testid={`row-ai-key-status-${k.id}`}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {k.name}
                        {k.isDefault ? (
                          <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                            default
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {PROVIDER_SHORT_LABEL[k.provider as AiProvider] ??
                          k.provider}
                        {" · ••••"}
                        {k.apiKeyLastFour}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusPill status={r.status} keyId={k.id} />
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid={`text-ai-key-checked-${k.id}`}
                      >
                        {r.checkedAt
                          ? formatRelative(r.checkedAt, nowTick)
                          : ""}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={r.status === "checking" || checkingAll}
                        onClick={() => {
                          void runCheck(k.id);
                        }}
                        data-testid={`button-check-ai-key-${k.id}`}
                      >
                        {r.status === "checking" ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : null}
                        Check status
                      </Button>
                    </div>
                  </div>
                  {r.status === "failing" && (r.message || r.reason) ? (
                    <div className="mt-2 text-xs">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground underline"
                        onClick={() =>
                          updateRow(k.id, { expanded: !r.expanded })
                        }
                        data-testid={`button-toggle-ai-key-details-${k.id}`}
                      >
                        {r.expanded ? "Hide details" : "Show details"}
                      </button>
                      {r.expanded ? (
                        <pre
                          className="mt-1 whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-[11px] text-foreground"
                          data-testid={`text-ai-key-details-${k.id}`}
                        >
                          {r.reason ? `[${r.reason}] ` : ""}
                          {trimDetail(r.message)}
                          {r.retryAfterSeconds !== null
                            ? `\nRetry after ${r.retryAfterSeconds}s`
                            : ""}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({
  status,
  keyId,
}: {
  status: RowStatus;
  keyId: string;
}) {
  const styles: Record<RowStatus, { label: string; className: string }> = {
    idle: {
      label: "Not checked",
      className:
        "bg-muted text-muted-foreground border-muted-foreground/20",
    },
    checking: {
      label: "Checking…",
      className:
        "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800",
    },
    ok: {
      label: "OK",
      className:
        "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-200 dark:border-green-800",
    },
    failing: {
      label: "Failing",
      className:
        "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-200 dark:border-red-800",
    },
  };
  const s = styles[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}
      data-testid={`pill-ai-key-status-${keyId}`}
    >
      {s.label}
    </span>
  );
}

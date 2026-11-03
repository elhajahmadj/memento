import {
  ChevronDown,
  ChevronRight,
  Download,
} from "lucide-react";
import {
  validationTraceUrl,
  type ValidationRunDto,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import {
  fmtDuration,
  fmtRelative,
  HISTORY_PAGE_SIZE,
  recordingLabel,
} from "@/features/tools/domain/validation-run-rules";
import { StatusBadge } from "./status-badge";
import { RunDetail } from "./run-detail";

interface Props {
  visibleRuns: ValidationRunDto[];
  totalRuns: number;
  hasMore: boolean;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onShowMore: () => void;
}

export function RunHistoryList({
  visibleRuns,
  totalRuns,
  hasMore,
  expanded,
  onToggle,
  onShowMore,
}: Props) {
  return (
    <section>
      <h2
        className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2"
        data-testid="heading-test-run-history"
      >
        Run history (newest first)
      </h2>
      <Card data-testid="card-test-run-history">
        <CardContent className="p-0">
          <ul className="divide-y" data-testid="list-test-run-history">
            {visibleRuns.map((r) => {
              const isOpen = expanded.has(r.id);
              return (
                <li
                  key={r.id}
                  className="px-3 py-2"
                  data-testid={`row-test-run-${r.id}`}
                >
                  <button
                    type="button"
                    onClick={() => onToggle(r.id)}
                    className="w-full text-left flex items-center gap-2"
                    data-testid={`button-toggle-run-${r.id}`}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                    <StatusBadge status={r.status} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono truncate">
                        {recordingLabel(r)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtRelative(r.queuedAt)} ·{" "}
                        {fmtDuration(r.startedAt, r.finishedAt)}
                        {r.parentRunId ? " · child of batch" : ""}
                      </div>
                    </div>
                    {r.traceRef && (
                      <a
                        href={validationTraceUrl(r.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-primary hover-elevate text-xs"
                        data-testid={`link-test-run-trace-${r.id}`}
                      >
                        <Download className="h-3 w-3" />
                        Trace
                      </a>
                    )}
                  </button>
                  {isOpen && <RunDetail runId={r.id} />}
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <div className="border-t p-2 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={onShowMore}
                data-testid="button-test-runs-show-more"
              >
                Show more ({totalRuns - visibleRuns.length} remaining)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export { HISTORY_PAGE_SIZE };

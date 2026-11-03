import { Badge } from "@/shared/ui/badge";
import { Card, CardContent } from "@/shared/ui/card";
import {
  PASS_RATE_WINDOW,
  type GroupSummary,
} from "@/features/tools/domain/validation-run-rules";
import { Sparkline } from "./sparkline";

export function PerTestTrends({ groups }: { groups: GroupSummary[] }) {
  if (groups.length === 0) return null;
  return (
    <section>
      <h2
        className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2"
        data-testid="heading-test-run-trends"
      >
        Per-test trends (last 30 days, up to {PASS_RATE_WINDOW} runs)
      </h2>
      <Card data-testid="card-test-run-trends">
        <CardContent className="p-0">
          <div className="divide-y">
            <div
              className="grid grid-cols-[1fr_72px_72px_88px_104px] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-mono"
              data-testid="row-test-run-trend-header"
            >
              <div>Test</div>
              <div className="text-right">Pass</div>
              <div className="text-right">Fail</div>
              <div className="text-right">Flakiness</div>
              <div className="text-right">Trend</div>
            </div>
            {groups.map((g) => {
              const ratePct = (g.passRate * 100).toFixed(0);
              const flakePct = (g.flakiness * 100).toFixed(0);
              return (
                <div
                  key={g.key}
                  className="grid grid-cols-[1fr_72px_72px_88px_104px] gap-2 px-3 py-2 items-center"
                  data-testid={`row-test-run-trend-${g.key}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {g.kind}
                      </Badge>
                      <div
                        className="font-mono text-sm truncate"
                        data-testid={`text-test-run-trend-path-${g.key}`}
                      >
                        {g.filePath}
                        {g.methodName ? ` › ${g.methodName}` : ""}
                      </div>
                    </div>
                    <div
                      className="mt-0.5 text-xs text-muted-foreground"
                      data-testid={`text-test-run-trend-pass-rate-${g.key}`}
                    >
                      Pass rate: {ratePct}% over {g.finishedInWindow} run
                      {g.finishedInWindow === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div
                    className="text-right text-sm tabular-nums text-emerald-600"
                    data-testid={`text-test-run-trend-passes-${g.key}`}
                  >
                    {g.passesInWindow}
                  </div>
                  <div
                    className={
                      "text-right text-sm tabular-nums " +
                      (g.failsInWindow > 0
                        ? "text-red-600"
                        : "text-muted-foreground")
                    }
                    data-testid={`text-test-run-trend-fails-${g.key}`}
                  >
                    {g.failsInWindow}
                  </div>
                  <div
                    className={
                      "text-right text-sm tabular-nums " +
                      (g.flakiness > 0
                        ? "text-amber-600"
                        : "text-muted-foreground")
                    }
                    data-testid={`text-test-run-trend-flakiness-${g.key}`}
                  >
                    {flakePct}%
                  </div>
                  <div className="flex justify-end">
                    <Sparkline runs={g.windowRuns} />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

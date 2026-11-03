import { useParams } from "wouter";
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  MinusCircle,
  FileWarning,
} from "lucide-react";
import {
  useGetAiAgentRun,
  getGetAiAgentRunQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/shared/ui/card";
import { PageShell } from "@/shared/ui/shell/page-shell";

export function AiRunStatus() {
  const params = useParams<{ projectName: string; runId: string }>();
  const projectName = decodeURIComponent(params.projectName ?? "");
  const runId = params.runId ?? "";
  const key = getGetAiAgentRunQueryKey(projectName, runId);
  const { data, isLoading } = useGetAiAgentRun(projectName, runId, {
    query: {
      queryKey: key,
      refetchInterval: (q) => {
        const v = q.state.data as { status?: string } | undefined;
        return v?.status === "succeeded" || v?.status === "failed"
          ? false
          : 1500;
      },
    },
  });

  return (
    <PageShell
      contentClassName="max-w-4xl"
      backTo="/workbench"
      backLabel="Back to workbench"
      backTestId="button-ai-run-back"
    >
      <div className="mb-6">
        <h1 className="text-3xl font-semibold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" /> AI run
        </h1>
        <p className="text-muted-foreground font-mono text-sm">{runId}</p>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              {data.status === "succeeded" ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : data.status === "failed" ? (
                <XCircle className="h-5 w-5 text-destructive" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin" />
              )}
              <div className="flex-1">
                <div className="font-semibold" data-testid="text-ai-run-status">
                  {data.status}
                </div>
                <div className="text-xs text-muted-foreground">
                  {data.kind} · {data.language} · {data.suiteName}
                </div>
              </div>
            </CardContent>
          </Card>

          {data.errorMessage ? (
            (() => {
              // The Build with AI emitters throw a structured
              // "cannot attach to '<rel>' — file not found." error
              // when an add_method run targets a spec that no longer
              // exists. Detect that shape and render it as a guided
              // error block (missing path + remediation) instead of
              // a raw monospace dump.
              const m = data.errorMessage.match(
                /Build with AI: cannot attach to ['"]([^'"]+)['"]/,
              );
              if (m) {
                const missing = m[1];
                return (
                  <Card className="border-destructive/40">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <FileWarning className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                        <div className="flex-1">
                          <div
                            className="text-sm font-semibold text-destructive mb-1"
                            data-testid="text-ai-run-missing-spec-title"
                          >
                            Can't find the spec you picked
                          </div>
                          <p
                            className="text-sm"
                            data-testid="text-ai-run-missing-spec-body"
                          >
                            The AI agent tried to add a method to{" "}
                            <code className="text-xs bg-muted px-1 py-0.5 rounded">
                              {missing}
                            </code>{" "}
                            but that file isn't in this project. It may
                            have been renamed, deleted, or moved since
                            you started the run.
                          </p>
                          <p className="text-sm text-muted-foreground mt-2">
                            Start a new Build with AI run and either
                            pick a different existing suite, or choose{" "}
                            <strong>New test suite</strong> to author a
                            standalone spec.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              }
              return (
                <Card>
                  <CardContent className="p-4">
                    <div className="text-sm font-semibold text-destructive mb-1">
                      Error
                    </div>
                    <pre
                      className="text-xs whitespace-pre-wrap"
                      data-testid="text-ai-run-error"
                    >
                      {data.errorMessage}
                    </pre>
                  </CardContent>
                </Card>
              );
            })()
          ) : null}

          <Card>
            <CardContent className="p-4">
              <div className="text-sm font-semibold mb-2">Plan</div>
              <pre className="text-xs whitespace-pre-wrap font-mono" data-testid="text-ai-run-plan">
                {data.plan}
              </pre>
            </CardContent>
          </Card>

          {data.report ? (
            <>
              <Card>
                <CardContent className="p-4">
                  <div className="text-sm font-semibold mb-2">Steps</div>
                  <ul className="space-y-1 text-sm" data-testid="list-ai-run-steps">
                    {(data.report.steps ?? []).map((s, i) => {
                      const status = s.status ?? "passed";
                      return (
                        <li
                          key={i}
                          className="flex items-start gap-2"
                          data-testid={`item-ai-run-step-${status}`}
                          data-step-status={status}
                        >
                          {status === "passed" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                          ) : status === "failed" ? (
                            <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                          ) : (
                            <MinusCircle
                              className="h-4 w-4 text-muted-foreground mt-0.5"
                              aria-label="Skipped"
                            />
                          )}
                          <span className={status === "skipped" ? "text-muted-foreground" : undefined}>
                            {s.message}
                            {status === "skipped" ? (
                              <span
                                className="ml-2 text-xs text-muted-foreground italic"
                                title="The AI couldn't auto-resolve this step to a known catalog method."
                              >
                                — skipped: AI couldn't auto-resolve this step
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-sm font-semibold mb-2">
                    Materialized files ({data.report.files?.length ?? 0})
                  </div>
                  <ul className="text-xs font-mono space-y-1" data-testid="list-ai-run-files">
                    {(data.report.files ?? []).map((f) => (
                      <li key={f.path} className="flex justify-between">
                        <span>{f.path}</span>
                        <span className="text-muted-foreground">
                          {f.bytes} bytes
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 text-sm">{data.report.summary}</div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      )}
    </PageShell>
  );
}

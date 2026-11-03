import { ArrowRight, ChevronDown, ChevronRight, Clock, Download, GitFork, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import type { ApprovalDto, ForkAvailableProject } from "@workspace/api-client-react";
import { ApprovalBadge } from "./approval-badge";
import { LanguageBadge } from "./language-badge";
import { SolutionTypeBadge } from "./solution-type-badge";
import { exportButtonLabel, useExportProject } from "../hooks/use-export-project";

interface Props {
  items: ForkAvailableProject[];
  byProject: Map<string, ApprovalDto[]>;
  latestByProject: Map<string, ApprovalDto>;
  expanded: Set<string>;
  onToggleExpanded: (project: string) => void;
  onSubmit: (forkId: string, projectName: string) => void;
  submitDisabled: boolean;
  onOpen: (forkPath: string, projectName: string) => void;
  openDisabled: boolean;
  onRequest: (projectName: string) => void;
  requestDisabled: boolean;
}

export function ForkProjectsList({
  items,
  byProject,
  latestByProject,
  expanded,
  onToggleExpanded,
  onSubmit,
  submitDisabled,
  onOpen,
  openDisabled,
  onRequest,
  requestDisabled,
}: Props) {
  const { exportProject, isExporting } = useExportProject();
  return (
    <ul className="space-y-3" data-testid="fork-list">
      {items.map((p) => {
        const projectApprovals = byProject.get(p.projectName) ?? [];
        const latest = latestByProject.get(p.projectName) ?? null;
        const isExpanded = expanded.has(p.projectName);
        return (
          <li key={p.projectName}>
            <Card className="border-card-border">
              <CardContent className="p-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2 flex-wrap">
                    <GitFork className="h-4 w-4 text-muted-foreground" />
                    {p.projectName}
                    <LanguageBadge language={p.language} />
                    <SolutionTypeBadge solutionType={p.solutionType} />
                    {latest ? (
                      <button
                        type="button"
                        onClick={() => onToggleExpanded(p.projectName)}
                        className="inline-flex items-center gap-1.5 rounded hover-elevate active-elevate-2 px-1 -mx-1 py-0.5 transition-colors"
                        data-testid={`button-toggle-history-${p.projectName}`}
                        aria-expanded={isExpanded}
                        aria-label={`Toggle approval history for ${p.projectName}`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        )}
                        <ApprovalBadge status={latest.status} />
                      </button>
                    ) : null}
                  </div>
                  {p.forkPath ? (
                    <div className="text-xs text-muted-foreground font-mono truncate max-w-md mt-0.5">
                      {p.forkPath}
                    </div>
                  ) : null}
                  {isExpanded && projectApprovals.length > 0 ? (
                    <ul className="mt-3 space-y-1.5">
                      {projectApprovals.map((a) => (
                        <li key={a.id} className="text-xs text-muted-foreground flex items-center gap-2">
                          <ApprovalBadge status={a.status} />
                          <span>
                            {formatDistanceToNow(new Date(a.submittedAt), { addSuffix: true })}
                          </span>
                          {a.comment ? (
                            <span className="truncate max-w-xs">— {a.comment}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.forkStatus === "active" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (!p.forkPath) return;
                          void exportProject({
                            solutionName: p.projectName,
                            language: p.language,
                            slnPath: `${p.forkPath}/${p.projectName}.sln`,
                          });
                        }}
                        data-testid={`button-export-fork-${p.projectName}`}
                        disabled={!p.forkPath || isExporting}
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        {exportButtonLabel(p.language)}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => p.forkId && onSubmit(p.forkId, p.projectName)}
                        data-testid={`button-submit-fork-${p.projectName}`}
                        disabled={!p.forkId || submitDisabled}
                      >
                        <Send className="h-3.5 w-3.5 mr-1" /> Submit
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => p.forkPath && onOpen(p.forkPath, p.projectName)}
                        data-testid={`button-open-fork-${p.projectName}`}
                        disabled={openDisabled}
                      >
                        Open <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </>
                  ) : p.forkStatus === "pending" ? (
                    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" /> Awaiting approval
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRequest(p.projectName)}
                      disabled={requestDisabled}
                      data-testid={`button-request-fork-${p.projectName}`}
                    >
                      Request fork
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

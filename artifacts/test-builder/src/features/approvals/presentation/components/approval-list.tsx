import {
  AlertTriangle,
  GitFork,
  Loader2,
  MessageSquare,
} from "lucide-react";
import type { ApprovalSummaryDto } from "@workspace/api-client-react";
import { formatDate, statusLabel } from "../format";

export function ApprovalList({
  loading,
  items,
  selectedId,
  onSelect,
}: {
  loading: boolean;
  items: ApprovalSummaryDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="rounded-md border border-card-border bg-card p-10 shadow-card flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div
        className="rounded-md border border-card-border bg-card p-10 shadow-card text-center text-sm text-muted-foreground"
        data-testid="approval-empty"
      >
        No submissions to show.
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-testid="approval-list">
      {items.map((s) => {
        const tag = statusLabel(s.status);
        const active = s.id === selectedId;
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              data-testid={`approval-row-${s.id}`}
              className={`w-full text-left rounded-md border bg-card hover-elevate active-elevate-2 px-4 py-3 transition-colors ${
                active ? "border-primary" : "border-card-border"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    <GitFork className="h-3.5 w-3.5 text-muted-foreground" />
                    {s.projectName}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {s.username} · {formatDate(s.submittedAt)}
                  </div>
                </div>
                <span
                  className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${tag.cls}`}
                >
                  {tag.text}
                </span>
              </div>
              {s.submitterComment && (
                <div
                  className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground line-clamp-2"
                  data-testid={`approval-submitter-comment-preview-${s.id}`}
                  title={s.submitterComment}
                >
                  <MessageSquare className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span className="line-clamp-2">{s.submitterComment}</span>
                </div>
              )}
              <div className="text-xs text-muted-foreground font-mono mt-2 flex items-center gap-2">
                <span>
                  {s.changedFiles}{" "}
                  {s.changedFiles === 1 ? "file changed" : "files changed"}
                </span>
                {s.conflictCount > 0 && s.status === "pending" && (
                  <span
                    className="inline-flex items-center gap-1 text-amber-500"
                    data-testid={`approval-conflict-${s.id}`}
                    title="Main has been edited since this submission was created"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {s.conflictCount} conflict
                    {s.conflictCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

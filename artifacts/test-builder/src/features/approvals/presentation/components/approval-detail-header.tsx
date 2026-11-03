import { AlertTriangle, CheckCircle2, GitFork, MessageSquare, XCircle } from "lucide-react";
import type { ApprovalDto } from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { formatDate, statusLabel } from "../format";

interface Props {
  meta: ApprovalDto;
  isPending: boolean;
  totalConflicts: number;
  conflictsAmongApplied: number;
  acknowledged: boolean;
  onAcknowledgeChange: (next: boolean) => void;
  filesToApply: number;
  totalFiles: number;
  someExcluded: boolean;
  approveBlocked: boolean;
  onApproveClick: () => void;
  onRejectClick: () => void;
}

export function ApprovalDetailHeader({
  meta,
  isPending,
  totalConflicts,
  conflictsAmongApplied,
  acknowledged,
  onAcknowledgeChange,
  filesToApply,
  totalFiles,
  someExcluded,
  approveBlocked,
  onApproveClick,
  onRejectClick,
}: Props) {
  const tag = statusLabel(meta.status);
  return (
    <div className="border-b border-card-border p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium text-lg flex items-center gap-2">
            <GitFork className="h-4 w-4 text-muted-foreground" />
            {meta.projectName}
          </div>
          <div className="text-sm text-muted-foreground">
            Submitted by {meta.username} on {formatDate(meta.submittedAt)}
          </div>
          {meta.decidedAt && (
            <div className="text-xs text-muted-foreground mt-1">
              Decided {formatDate(meta.decidedAt)}
              {meta.comment ? ` — "${meta.comment}"` : ""}
            </div>
          )}
          {meta.submitterComment && (
            <div
              className="mt-3 rounded-md border border-card-border bg-muted/40 p-3 text-sm"
              data-testid="approval-submitter-comment"
            >
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <MessageSquare className="h-3 w-3" />
                Submitter's note
              </div>
              <div className="whitespace-pre-wrap break-words">{meta.submitterComment}</div>
            </div>
          )}
        </div>
        <span
          className={`text-[11px] uppercase tracking-wide px-2 py-1 rounded-full border ${tag.cls}`}
        >
          {tag.text}
        </span>
      </div>

      {isPending && totalConflicts > 0 && (
        <div
          className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-start gap-2"
          data-testid="approval-conflict-banner"
        >
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium text-amber-200">
              Main has changed since this submission was created
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {totalConflicts} file{totalConflicts === 1 ? "" : "s"} in this diff{" "}
              {totalConflicts === 1 ? "has" : "have"} been modified in main since the
              snapshot was taken. Approving will overwrite those edits. Uncheck conflicting
              files to skip them, or acknowledge below to proceed anyway.
            </div>
            {conflictsAmongApplied > 0 && (
              <label className="mt-2 inline-flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(v) => onAcknowledgeChange(v === true)}
                  data-testid="checkbox-ack-conflicts"
                />
                <span>
                  I understand approving will overwrite {conflictsAmongApplied} conflicting
                  file{conflictsAmongApplied === 1 ? "" : "s"} in main.
                </span>
              </label>
            )}
          </div>
        </div>
      )}

      {isPending && (
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <Button
            size="sm"
            onClick={onApproveClick}
            disabled={approveBlocked}
            data-testid="button-approve"
          >
            <CheckCircle2 className="h-4 w-4 mr-1" />
            {someExcluded ? `Approve ${filesToApply} of ${totalFiles} files` : "Approve & merge"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onRejectClick}
            data-testid="button-reject"
          >
            <XCircle className="h-4 w-4 mr-1" /> Reject
          </Button>
          {filesToApply === 0 && totalFiles > 0 && (
            <span className="text-xs text-muted-foreground">
              Select at least one file to approve.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

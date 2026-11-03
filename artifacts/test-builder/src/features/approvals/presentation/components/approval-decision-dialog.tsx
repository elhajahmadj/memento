import { Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";

interface Props {
  action: "approve" | "reject" | null;
  someExcluded: boolean;
  filesToApply: number;
  totalFiles: number;
  conflictsAmongApplied: number;
  comment: string;
  onCommentChange: (next: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}

export function ApprovalDecisionDialog({
  action,
  someExcluded,
  filesToApply,
  totalFiles,
  conflictsAmongApplied,
  comment,
  onCommentChange,
  onCancel,
  onConfirm,
  pending,
}: Props) {
  return (
    <Dialog open={action !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {action === "approve"
              ? someExcluded
                ? `Approve ${filesToApply} of ${totalFiles} files?`
                : "Approve & merge into main?"
              : "Reject this submission?"}
          </DialogTitle>
          <DialogDescription>
            {action === "approve"
              ? someExcluded
                ? "Only the checked files will be applied. Unchecked files stay as they are in main."
                : "The fork's files will be copied over the main project tree. Files removed in the fork are deleted from main."
              : "The submitter will see the rejection comment when they next open the project."}
          </DialogDescription>
        </DialogHeader>
        {action === "approve" && conflictsAmongApplied > 0 && (
          <div className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
            {conflictsAmongApplied} conflicting file
            {conflictsAmongApplied === 1 ? "" : "s"} in main will be overwritten.
          </div>
        )}
        <div className="py-2">
          <Textarea
            placeholder={
              action === "reject" ? "Optional comment (recommended)" : "Optional comment"
            }
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            data-testid="input-decision-comment"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} data-testid="button-decision-cancel">
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending} data-testid="button-decision-confirm">
            {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {action === "approve"
              ? someExcluded
                ? "Apply selected"
                : "Approve & merge"
              : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

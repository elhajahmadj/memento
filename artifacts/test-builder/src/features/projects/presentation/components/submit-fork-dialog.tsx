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
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";

interface Props {
  projectName: string | null;
  comment: string;
  onCommentChange: (next: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  pending: boolean;
}

export function SubmitForkDialog({
  projectName,
  comment,
  onCommentChange,
  onCancel,
  onSubmit,
  pending,
}: Props) {
  return (
    <Dialog
      open={!!projectName}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit {projectName ?? ""} for approval</DialogTitle>
          <DialogDescription>
            An admin will review your fork before it can be merged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="submit-comment">Comment (optional)</Label>
          <Textarea
            id="submit-comment"
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            placeholder="What changed?"
            data-testid="textarea-submit-comment"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSubmit} disabled={pending} data-testid="button-confirm-submit">
            {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

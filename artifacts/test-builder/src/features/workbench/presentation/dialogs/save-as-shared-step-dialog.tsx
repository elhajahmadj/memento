import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Loader2 } from "lucide-react";
import type { RecordedActionMsg } from "@/features/workbench/domain/types";

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 _-]*$/;

export function SaveAsSharedStepDialog({
  open,
  onOpenChange,
  actions,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  actions: RecordedActionMsg[];
  onSaved?: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setSubmitting(false);
    }
  }, [open]);

  const nameValid = NAME_PATTERN.test(name.trim());
  const canSubmit = !submitting && nameValid && actions.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        // Strip UI-only fields so the server stores a clean
        // RecordedAction[] snippet that future inserts will splice
        // back as-is. Selector + value + assertion + wait fields are
        // preserved; index / suggestedMethodName / decoratedMethodName
        // are display hints that the recorder regenerates per session.
        actions: actions.map((a) => {
          const {
            index: _index,
            suggestedMethodName: _suggested,
            suggestedNoun: _noun,
            decoratedMethodName: _decorated,
            ...rest
          } = a;
          void _index;
          void _suggested;
          void _noun;
          void _decorated;
          return rest;
        }),
      };
      const res = await fetch("/api/shared-steps", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(errBody || `HTTP ${res.status}`);
      }
      toast.success(
        `Saved ${actions.length} step${actions.length === 1 ? "" : "s"} as "${name.trim()}"`,
      );
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(`Failed to save: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-save-as-shared-step"
      >
        <DialogHeader>
          <DialogTitle>Save as shared step</DialogTitle>
          <DialogDescription>
            Save the selected recorded actions as a reusable macro. The
            macro is scoped to your account and current project, and can
            be inserted into future recordings from the Insert shared
            step button.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="save-shared-step-name">Name</Label>
            <Input
              id="save-shared-step-name"
              data-testid="input-shared-step-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="LoginAsAdmin"
              autoComplete="off"
            />
            {!nameValid && name.length > 0 && (
              <p className="text-xs text-destructive">
                Name must start with a letter and contain only letters,
                digits, spaces, hyphens or underscores.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="save-shared-step-description">
              Description (optional)
            </Label>
            <Textarea
              id="save-shared-step-description"
              data-testid="input-shared-step-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="What this macro does, so future-you knows when to use it."
              rows={3}
            />
          </div>
          <div className="rounded border bg-muted/40 p-2">
            <div className="text-xs text-muted-foreground mb-1">
              Selected steps ({actions.length})
            </div>
            <ScrollArea className="max-h-40">
              <ol className="text-xs font-mono space-y-0.5">
                {actions.map((a, i) => (
                  <li key={i} className="text-foreground/80">
                    {i + 1}. {a.type ?? "step"}
                    {a.selector ? ` — ${a.selector}` : ""}
                    {a.value ? ` = ${a.value}` : ""}
                  </li>
                ))}
              </ol>
            </ScrollArea>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            data-testid="button-save-shared-step-confirm"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

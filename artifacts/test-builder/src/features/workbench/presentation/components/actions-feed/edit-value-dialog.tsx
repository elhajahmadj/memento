import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import type { RecordedActionMsg } from "@/features/workbench/domain/types";
import { describeEditable } from "./helpers";

/**
 * Modal that lets the user edit the typed text / URL / expected value
 * of a single recorded action. On confirm it dispatches
 * `recorder:request-edit-action` with the new payload — the recording
 * canvas forwards that to the server, which calls `applyEditToAction`,
 * re-emits a feed reset, and re-broadcasts the body preview.
 */
export function EditValueDialog({
  target,
  onClose,
}: {
  target: RecordedActionMsg | null;
  onClose: () => void;
}) {
  const desc = target ? describeEditable(target) : null;
  const [draft, setDraft] = useState<string>("");
  useEffect(() => {
    if (target) setDraft(describeEditable(target).value);
  }, [target]);
  const open = target !== null;
  if (!open || !desc || !target || typeof target.index !== "number") {
    return (
      <Dialog open={false} onOpenChange={(v) => !v && onClose()}>
        <DialogContent />
      </Dialog>
    );
  }
  // Capture the prior detail so the post-save toast can roll back to
  // the exact value that was on the action before the edit. Mirrors
  // the field-level switch below; keep them in sync.
  const buildDetail = (value: string): Record<string, unknown> | null => {
    const detail: Record<string, unknown> = { index: target.index };
    if (target.type === "fill" || target.type === "select") {
      detail.value = value;
    } else if (target.type === "navigate") {
      detail.url = value;
    } else if (target.type === "assert") {
      switch (target.assertKind) {
        case "element-has-text":
          detail.assertText = value;
          break;
        case "url-contains":
        case "url-equals":
          detail.assertUrl = value;
          break;
        case "element-count-equals": {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0) {
            toast.error("Count must be a non-negative number");
            return null;
          }
          detail.assertCount = Math.floor(n);
          break;
        }
        case "attribute-equals":
          detail.assertAttrValue = value;
          break;
        case "value-equals":
          detail.assertValue = value;
          break;
        case "response-status": {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 100 || n > 599) {
            toast.error("Status code must be between 100 and 599");
            return null;
          }
          detail.assertStatusCode = Math.floor(n);
          break;
        }
      }
    }
    return detail;
  };
  const handleSave = () => {
    const priorValue = describeEditable(target).value;
    const detail = buildDetail(draft);
    if (!detail) return;
    window.dispatchEvent(
      new CustomEvent("recorder:request-edit-action", { detail }),
    );
    // Per-edit undo: replay the same edit-action-value with the
    // pre-edit value. Validation errors in `buildDetail` won't apply
    // here because the prior value was already accepted by the
    // server, so the undo path constructs the inverse detail without
    // re-running numeric guards.
    const undoDetail = buildDetail(priorValue);
    if (undoDetail) {
      toast.success("Step value updated", {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            window.dispatchEvent(
              new CustomEvent("recorder:request-edit-action", {
                detail: undoDetail,
              }),
            );
          },
        },
      });
    }
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-edit-action-value"
      >
        <DialogHeader>
          <DialogTitle>Edit recorded value</DialogTitle>
          <DialogDescription>
            Update the {desc.label.toLowerCase()} for this {target.type}{" "}
            step. The change is audited and the live code preview will
            refresh.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="edit-action-value">{desc.label}</Label>
          <Input
            id="edit-action-value"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            inputMode={desc.kind === "number" ? "numeric" : undefined}
            data-testid="input-edit-action-value"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            data-testid="button-edit-action-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            data-testid="button-edit-action-save"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

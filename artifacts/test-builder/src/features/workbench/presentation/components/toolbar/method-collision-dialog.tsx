import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

export interface MethodCollision {
  methodName: string;
  suggestedName: string;
  targetClass: string;
}

export function MethodCollisionDialog({
  collision,
  renameValue,
  onRenameChange,
  finalizePending,
  canSaveDirectly,
  onCancel,
  onOverwrite,
  onRename,
}: {
  collision: MethodCollision | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  finalizePending: boolean;
  /** See StoppedStateControls: admins and guests both save directly. */
  canSaveDirectly: boolean;
  onCancel: () => void;
  onOverwrite: (mode: "save" | "submit-for-approval") => void;
  onRename: (mode: "save" | "submit-for-approval", name: string) => void;
}) {
  const renameValid = /^[A-Za-z_][A-Za-z0-9_]*$/.test(renameValue.trim());
  const renameDiffersFromExisting =
    renameValue.trim() !== (collision?.methodName ?? "");
  const mode: "save" | "submit-for-approval" = canSaveDirectly
    ? "save"
    : "submit-for-approval";
  return (
    <AlertDialog
      open={!!collision}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <AlertDialogContent data-testid="dialog-method-collision">
        <AlertDialogHeader>
          <AlertDialogTitle>Method name already exists</AlertDialogTitle>
          <AlertDialogDescription>
            <code>{collision?.methodName}</code> is already a <code>[Test]</code>{" "}
            method in <code>{collision?.targetClass}</code>. Choose how to save
            the recording.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="rename-input" className="text-xs">
              Save as a different name
            </Label>
            <Input
              id="rename-input"
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              placeholder="UniqueMethodName"
              data-testid="input-collision-rename"
            />
            {!renameValid && renameValue.length > 0 && (
              <p className="text-xs text-destructive">
                Must start with a letter or underscore and contain only letters,
                digits, or underscores.
              </p>
            )}
            {renameValid && !renameDiffersFromExisting && (
              <p className="text-xs text-destructive">
                Pick a different name from the existing method.
              </p>
            )}
          </div>
        </div>
        <AlertDialogFooter className="flex-wrap gap-2">
          <AlertDialogCancel
            onClick={onCancel}
            data-testid="button-collision-cancel"
          >
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => onOverwrite(mode)}
            disabled={finalizePending}
            data-testid="button-collision-overwrite"
          >
            Overwrite existing
          </Button>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              if (!renameValid || !renameDiffersFromExisting) return;
              onRename(mode, renameValue.trim());
            }}
            disabled={
              finalizePending || !renameValid || !renameDiffersFromExisting
            }
            data-testid="button-collision-rename"
          >
            Save as new name
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

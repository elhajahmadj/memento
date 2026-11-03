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

export function ConfirmHookOverwriteDialog({
  open,
  onOpenChange,
  hookLabel,
  hookCurrentBody,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hookLabel: string;
  hookCurrentBody: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Overwrite custom {hookLabel} body?
          </AlertDialogTitle>
          <AlertDialogDescription>
            <code>{hookLabel}</code> in this class currently contains custom
            code. Starting the recording will replace its body entirely and
            the existing code cannot be recovered. Review the current body
            below and copy anything you want to keep before continuing.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {hookCurrentBody && (
          <pre
            className="max-h-60 overflow-auto rounded border bg-muted/50 p-2 text-xs leading-snug font-mono whitespace-pre"
            data-testid="confirm-preview-hook-current-body"
          >
            {hookCurrentBody}
          </pre>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-overwrite-hook">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            data-testid="button-confirm-overwrite-hook"
          >
            Overwrite and record
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ConfirmMethodOverwriteDialog({
  open,
  onOpenChange,
  finalMethodName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  finalMethodName: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dialog-confirm-method-overwrite">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Overwrite existing test method?
          </AlertDialogTitle>
          <AlertDialogDescription>
            A <code>[Test]</code> method named{" "}
            <code>{finalMethodName}</code> already exists in this class.
            Continuing will replace its body with the new recording when you
            stop. The previous code cannot be recovered.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-overwrite-method">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            data-testid="button-confirm-overwrite-method"
          >
            Overwrite and record
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

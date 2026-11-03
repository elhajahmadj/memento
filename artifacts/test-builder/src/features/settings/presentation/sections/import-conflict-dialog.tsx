import type { Architecture } from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export function ImportConflictDialog({
  pendingImport,
  importRenameMode,
  setImportRenameMode,
  importRenameValue,
  setImportRenameValue,
  closeImportDialog,
  handleImportKeepBoth,
  handleImportConfirmRename,
  upsertPending,
}: {
  pendingImport: Architecture | null;
  importRenameMode: boolean;
  setImportRenameMode: (v: boolean) => void;
  importRenameValue: string;
  setImportRenameValue: (v: string) => void;
  closeImportDialog: () => void;
  handleImportKeepBoth: () => void;
  handleImportConfirmRename: () => void;
  upsertPending: boolean;
}) {
  return (
    <Dialog
      open={!!pendingImport}
      onOpenChange={(o) => !o && closeImportDialog()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Architecture name already exists</DialogTitle>
          <DialogDescription>
            {importRenameMode ? (
              <>Pick a new name for the imported architecture.</>
            ) : (
              <>
                An architecture named{" "}
                <span className="font-mono">{pendingImport?.name}</span>{" "}
                already exists. What would you like to do?
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {importRenameMode && (
          <div className="py-2 space-y-2">
            <Label htmlFor="import-rename">Name</Label>
            <Input
              id="import-rename"
              autoFocus
              value={importRenameValue}
              onChange={(e) => setImportRenameValue(e.target.value)}
              data-testid="input-import-rename"
            />
          </div>
        )}
        <DialogFooter>
          {importRenameMode ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setImportRenameMode(false)}
                disabled={upsertPending}
                data-testid="button-import-rename-back"
              >
                Back
              </Button>
              <Button
                onClick={handleImportConfirmRename}
                disabled={upsertPending}
                data-testid="button-import-rename-save"
              >
                Save
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={closeImportDialog}
                disabled={upsertPending}
                data-testid="button-import-cancel"
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={() => setImportRenameMode(true)}
                disabled={upsertPending}
                data-testid="button-import-rename"
              >
                Rename
              </Button>
              <Button
                onClick={handleImportKeepBoth}
                disabled={upsertPending}
                data-testid="button-import-keep-both"
              >
                Keep both
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { CheckCircle2, XCircle, Upload } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import type { ImportResult } from "@/features/settings/domain/architecture-helpers";

export function ImportResultsDialog({
  importResults,
  setImportResults,
  isDialogDragOver,
  retryInputRef,
  handleRetryFailedFile,
  handleRetryFailedClick,
  handleDialogDragEnter,
  handleDialogDragOver,
  handleDialogDragLeave,
  handleDialogDrop,
  onJumpToArchitecture,
  upsertPending,
}: {
  importResults: ImportResult[] | null;
  setImportResults: (r: ImportResult[] | null) => void;
  isDialogDragOver: boolean;
  retryInputRef: React.RefObject<HTMLInputElement | null>;
  handleRetryFailedFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRetryFailedClick: () => void;
  handleDialogDragEnter: (e: React.DragEvent) => void;
  handleDialogDragOver: (e: React.DragEvent) => void;
  handleDialogDragLeave: (e: React.DragEvent) => void;
  handleDialogDrop: (e: React.DragEvent) => void;
  onJumpToArchitecture: (id: string) => void;
  upsertPending: boolean;
}) {
  return (
    <Dialog
      open={!!importResults}
      onOpenChange={(o) => !o && setImportResults(null)}
    >
      <DialogContent
        className="sm:max-w-lg"
        data-testid="dialog-import-results"
        onDragEnter={handleDialogDragEnter}
        onDragOver={handleDialogDragOver}
        onDragLeave={handleDialogDragLeave}
        onDrop={handleDialogDrop}
      >
        {isDialogDragOver &&
          importResults?.some((r) => r.status === "error") && (
            <div
              className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/90"
              data-testid="dialog-import-results-drop-overlay"
            >
              <div className="flex items-center gap-2 text-primary font-medium">
                <Upload className="h-5 w-5" />
                Drop matching JSON files to retry
              </div>
            </div>
          )}
        <DialogHeader>
          <DialogTitle>Import results</DialogTitle>
          <DialogDescription>
            {importResults && (
              <>
                {importResults.filter((r) => r.status === "success").length} of{" "}
                {importResults.length} file
                {importResults.length === 1 ? "" : "s"} imported successfully.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <ul className="space-y-2 py-1">
            {importResults?.map((r, i) => (
              <li
                key={`${r.fileName}-${i}`}
                className="rounded-md border border-border bg-card px-3 py-2"
                data-testid={`row-import-result-${i}`}
              >
                <div className="flex items-start gap-2">
                  {r.status === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm truncate" title={r.fileName}>
                      {r.fileName}
                    </div>
                    {r.status === "success" ? (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Imported as{" "}
                        <span className="font-medium text-foreground">
                          {r.architectureName}
                        </span>
                      </div>
                    ) : (
                      <div className="text-xs text-destructive mt-0.5">
                        {r.reason}
                      </div>
                    )}
                  </div>
                  {r.status === "success" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onJumpToArchitecture(r.architectureId)}
                      data-testid={`button-jump-to-arch-${i}`}
                    >
                      View
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </ScrollArea>
        <DialogFooter>
          <input
            ref={retryInputRef}
            type="file"
            accept="application/json,.json"
            multiple
            className="hidden"
            onChange={handleRetryFailedFile}
            data-testid="input-retry-failed-import"
          />
          {importResults?.some((r) => r.status === "error") && (
            <Button
              variant="outline"
              onClick={handleRetryFailedClick}
              disabled={upsertPending}
              data-testid="button-retry-failed-import"
            >
              <Upload className="h-4 w-4 mr-1.5" />
              Retry failed
            </Button>
          )}
          <Button
            onClick={() => setImportResults(null)}
            data-testid="button-close-import-results"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

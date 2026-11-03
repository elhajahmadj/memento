import { useState } from "react";
import { toast } from "sonner";
import { Archive, Trash2, Loader2 } from "lucide-react";
import { useClearHookBackups } from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export function MaintenanceSection() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const clear = useClearHookBackups({
    mutation: {
      onSuccess: (res) => {
        setConfirmOpen(false);
        if (res.deletedCount === 0) {
          toast.info("No hook backup files to clear");
        } else {
          toast.success(
            res.deletedCount === 1
              ? "Cleared 1 hook backup file"
              : `Cleared ${res.deletedCount} hook backup files`,
          );
        }
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to clear hook backups"),
    },
  });

  return (
    <section data-testid="section-maintenance">
      <div className="rounded-md border border-border bg-card p-4 shadow-card flex items-start justify-between gap-4">
        <div>
          <div className="font-medium flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" />
            Hook backups
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-prose">
            Each time you re-record a SetUp or OneTimeSetUp hook with custom
            code, the previous body is saved as a sibling{" "}
            <span className="font-mono">.bak</span> file. Clear them all at
            once for a clean slate before zipping up the project.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setConfirmOpen(true)}
          disabled={clear.isPending}
          data-testid="button-clear-hook-backups"
        >
          <Trash2 className="h-4 w-4 mr-1.5" />
          Clear all
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => !o && !clear.isPending && setConfirmOpen(false)}
      >
        <DialogContent
          className="sm:max-w-md"
          data-testid="dialog-confirm-clear-hook-backups"
        >
          <DialogHeader>
            <DialogTitle>Clear all hook backups?</DialogTitle>
            <DialogDescription>
              This will delete every hook backup{" "}
              <span className="font-mono">.bak</span> file in the active
              project. Only files saved by the recorder are touched — your
              source code is left alone. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={clear.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => clear.mutate()}
              disabled={clear.isPending}
              data-testid="button-confirm-clear-hook-backups"
            >
              {clear.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Delete backups
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

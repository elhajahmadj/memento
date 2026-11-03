import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useDeleteFile,
  getGetProjectTreeQueryKey,
  getListTestClassesQueryKey,
} from "@workspace/api-client-react";
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

import { invalidateDiscoveredTests } from "@/features/workbench/presentation/lib/invalidate-discovered-tests";
import type { TreeNodeT } from "@/features/workbench/domain/types";

export function DeleteConfirmDialog({
  target,
  onClose,
}: {
  target: TreeNodeT | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const del = useDeleteFile({
    mutation: {
      onSuccess: async () => {
        toast.success("Deleted");
        await qc.invalidateQueries({ queryKey: getGetProjectTreeQueryKey() });
        await qc.invalidateQueries({ queryKey: getListTestClassesQueryKey() });
        await invalidateDiscoveredTests(qc);
        onClose();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed"),
    },
  });
  return (
    <AlertDialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        {/*
          Generated paths are long and have no spaces to wrap on
          (`Foo.Tests/PageObjects/Actions/SomeLongSuiteNameActions.cs`),
          so without an explicit break rule the monospace path — and a
          long file name in the title — render straight through the
          dialog border. `break-all` is the right rule here rather than
          `break-words`: these are unbroken path tokens, so there is no
          word boundary to prefer.
        */}
        <AlertDialogHeader className="min-w-0">
          <AlertDialogTitle className="break-words">
            Delete {target?.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes{" "}
            <span className="font-mono break-all">{target?.path}</span> from
            disk. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              target &&
              del.mutate({ params: { path: target.path } })
            }
            data-testid="button-confirm-delete"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

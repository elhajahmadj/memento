import { Link } from "wouter";
import { Loader2 } from "lucide-react";
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
import type { AiAgentKey } from "@workspace/api-client-react";

export interface DeleteConflict {
  id: string;
  boundProjects: string[];
  message: string;
}

interface DeleteDialogProps {
  deleting: AiAgentKey | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function KeyDeleteDialog({
  deleting,
  pending,
  onCancel,
  onConfirm,
}: DeleteDialogProps) {
  return (
    <AlertDialog
      open={deleting !== null}
      onOpenChange={(o) => !o && onCancel()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete AI key?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the key named{" "}
            <span className="font-mono">{deleting?.name}</span>. If any
            project is currently bound to it, the delete will be blocked.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-ai-keys-cancel-delete">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={pending}
            data-testid="button-ai-keys-confirm-delete"
          >
            {pending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface BoundConflictDialogProps {
  conflict: DeleteConflict | null;
  onClose: () => void;
}

export function KeyBoundConflictDialog({
  conflict,
  onClose,
}: BoundConflictDialogProps) {
  return (
    <AlertDialog
      open={conflict !== null}
      onOpenChange={(o) => !o && onClose()}
    >
      <AlertDialogContent data-testid="dialog-ai-keys-bound-conflict">
        <AlertDialogHeader>
          <AlertDialogTitle>Key is still in use</AlertDialogTitle>
          <AlertDialogDescription>
            {conflict?.message ??
              "This key is bound to one or more projects."}{" "}
            Clear the override on each project, then try again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {conflict?.boundProjects?.length ? (
          <ul className="text-sm space-y-1 max-h-48 overflow-y-auto pr-2">
            {conflict.boundProjects.map((name) => (
              <li
                key={name}
                className="flex items-center justify-between gap-2"
                data-testid={`ai-keys-bound-project-${name}`}
              >
                <span className="font-mono truncate">{name}</span>
                <Link
                  href={`/settings/manage-projects?project=${encodeURIComponent(name)}`}
                  onClick={onClose}
                  className="text-xs text-primary underline shrink-0"
                  data-testid={`link-ai-keys-bound-project-${name}`}
                >
                  Open project
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={onClose}
            data-testid="button-ai-keys-bound-ack"
          >
            OK
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

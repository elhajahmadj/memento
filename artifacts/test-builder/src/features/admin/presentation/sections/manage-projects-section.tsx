import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, Trash2, Eraser, Clock } from "lucide-react";
import {
  useListAvailableProjects,
  useSetProjectDisabled,
  useDeleteProject,
  useClearProjectFiles,
  useCancelProjectLifecycleRequest,
  getDeleteProjectPreflight,
  getClearProjectFilesPreflight,
  getGetCurrentProjectQueryKey,
  getListProjectLifecycleRequestsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

type PreflightState = {
  requiresApproval: boolean;
  isSoleAdmin: boolean;
  hasPendingRequest?: boolean;
};

export function ManageProjectsSection({
  canDelete = true,
  canClear = canDelete,
  scoped = false,
}: {
  canDelete?: boolean;
  canClear?: boolean;
  scoped?: boolean;
}) {
  const qc = useQueryClient();
  const { data: availableRaw, isLoading } = useListAvailableProjects({
    query: { queryKey: ["listAvailableProjects"] },
  });
  const available = scoped
    ? availableRaw?.filter((p) => p.hasAccess !== false)
    : availableRaw;
  const [confirmDelete, setConfirmDelete] = useState<{
    slnPath: string;
    solutionName: string;
    pendingRequestId?: string | null;
    pendingIsOwn?: boolean;
  } | null>(null);
  const [preflight, setPreflight] = useState<PreflightState | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmClear, setConfirmClear] = useState<{
    slnPath: string;
    solutionName: string;
    pendingRequestId?: string | null;
    pendingIsOwn?: boolean;
  } | null>(null);
  const [clearPreflight, setClearPreflight] = useState<PreflightState | null>(
    null,
  );
  const [clearAck, setClearAck] = useState(false);

  useEffect(() => {
    if (!confirmDelete) {
      setPreflight(null);
      setAcknowledged(false);
      return;
    }
    let cancelled = false;
    setPreflight(null);
    setAcknowledged(false);
    getDeleteProjectPreflight(confirmDelete.solutionName)
      .then((r) => {
        if (!cancelled) setPreflight(r);
      })
      .catch((e: Error) => {
        if (!cancelled) toast.error(e.message ?? "Failed to load preflight");
      });
    return () => {
      cancelled = true;
    };
  }, [confirmDelete]);

  useEffect(() => {
    if (!confirmClear) {
      setClearPreflight(null);
      setClearAck(false);
      return;
    }
    let cancelled = false;
    setClearPreflight(null);
    setClearAck(false);
    getClearProjectFilesPreflight(confirmClear.solutionName)
      .then((r) => {
        if (!cancelled) setClearPreflight(r);
      })
      .catch((e: Error) => {
        if (!cancelled) toast.error(e.message ?? "Failed to load preflight");
      });
    return () => {
      cancelled = true;
    };
  }, [confirmClear]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["listAvailableProjects"] });
    await qc.invalidateQueries({ queryKey: getGetCurrentProjectQueryKey() });
    await qc.invalidateQueries({
      queryKey: getListProjectLifecycleRequestsQueryKey(),
    });
  };

  const setDisabled = useSetProjectDisabled({
    mutation: {
      onSuccess: async (_d, vars) => {
        toast.success(
          vars.data.disabled ? "Project disabled" : "Project enabled",
        );
        await refresh();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed"),
    },
  });

  const remove = useDeleteProject({
    mutation: {
      onSuccess: async (resp) => {
        const status = (resp as { status?: string } | undefined)?.status;
        toast.success(
          status === "pending"
            ? "Deletion request submitted for approval"
            : "Project deleted",
        );
        setConfirmDelete(null);
        await refresh();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed"),
    },
  });

  const cancelReq = useCancelProjectLifecycleRequest({
    mutation: {
      onSuccess: async () => {
        toast.success("Pending request cancelled");
        setConfirmDelete(null);
        setConfirmClear(null);
        await refresh();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed"),
    },
  });

  const clearFiles = useClearProjectFiles({
    mutation: {
      onSuccess: async (resp) => {
        const status = (resp as { status?: string } | undefined)?.status;
        toast.success(
          status === "pending"
            ? "Clear-files request submitted for approval"
            : "Project files cleared",
        );
        setConfirmClear(null);
        await refresh();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed"),
    },
  });

  const needsAck = preflight?.isSoleAdmin === true;
  const blockedByPending = preflight?.hasPendingRequest === true;
  const dialogPending = confirmDelete?.pendingRequestId ?? null;
  const clearNeedsAck = clearPreflight?.isSoleAdmin === true;
  const clearBlockedByPending = clearPreflight?.hasPendingRequest === true;
  const clearDialogPending = confirmClear?.pendingRequestId ?? null;

  return (
    <section>
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : available && available.length > 0 ? (
        <ul className="space-y-2">
          {available.map((p) => (
            <li
              key={p.slnPath}
              className="rounded-md border border-border bg-card px-4 py-3 flex items-center justify-between gap-3"
              data-testid={`row-manage-${p.solutionName}`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium flex items-center gap-2">
                  {p.solutionName}
                  {p.disabled && (
                    <span className="text-xs font-mono uppercase text-muted-foreground border border-border rounded px-1.5 py-0.5">
                      disabled
                    </span>
                  )}
                  {p.pendingDeletion && (
                    <span
                      className="text-xs uppercase text-amber-700 border border-amber-300 bg-amber-50 rounded px-1.5 py-0.5 inline-flex items-center gap-1"
                      data-testid={`badge-pending-deletion-${p.solutionName}`}
                      title={`Requested by ${p.pendingDeletion.requestedByUsername}`}
                    >
                      <Clock className="h-3 w-3" />
                      Pending deletion
                    </span>
                  )}
                  {p.pendingClearFiles && (
                    <span
                      className="text-xs uppercase text-amber-700 border border-amber-300 bg-amber-50 rounded px-1.5 py-0.5 inline-flex items-center gap-1"
                      data-testid={`badge-pending-clear-files-${p.solutionName}`}
                      title={`Requested by ${p.pendingClearFiles.requestedByUsername}`}
                    >
                      <Clock className="h-3 w-3" />
                      Pending file clear
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  {p.slnPath}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDisabled.mutate({
                      data: { slnPath: p.slnPath, disabled: !p.disabled },
                    })
                  }
                  disabled={setDisabled.isPending}
                  data-testid={`button-toggle-${p.solutionName}`}
                >
                  {p.disabled ? (
                    <>
                      <Eye className="h-4 w-4 mr-1.5" />
                      Enable
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-4 w-4 mr-1.5" />
                      Disable
                    </>
                  )}
                </Button>
                {canClear && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setConfirmClear({
                        slnPath: p.slnPath,
                        solutionName: p.solutionName,
                        pendingRequestId:
                          p.pendingClearFiles?.requestId ?? null,
                        pendingIsOwn:
                          p.pendingClearFiles?.isOwnRequest ?? false,
                      })
                    }
                    data-testid={`button-clear-files-${p.solutionName}`}
                  >
                    <Eraser className="h-4 w-4 mr-1.5" />
                    Clear files
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() =>
                      setConfirmDelete({
                        slnPath: p.slnPath,
                        solutionName: p.solutionName,
                        pendingRequestId:
                          p.pendingDeletion?.requestId ?? null,
                        pendingIsOwn:
                          p.pendingDeletion?.isOwnRequest ?? false,
                      })
                    }
                    data-testid={`button-delete-${p.solutionName}`}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-center py-10 text-sm text-muted-foreground">
          No solutions found in the workspace.
        </div>
      )}

      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialogPending
                ? "Pending deletion request"
                : needsAck
                ? "Delete project?"
                : "Request project deletion?"}
            </DialogTitle>
            <DialogDescription>
              {dialogPending ? (
                <>
                  A deletion request is already pending for{" "}
                  <span className="font-mono">
                    {confirmDelete?.solutionName}
                  </span>
                  . You can cancel it here.
                </>
              ) : preflight === null ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking permissions…
                </span>
              ) : needsAck ? (
                <>
                  You are the only admin available to approve a deletion of{" "}
                  <span className="font-mono">
                    {confirmDelete?.solutionName}
                  </span>
                  . The project will be permanently removed from disk —{" "}
                  <strong>this cannot be undone.</strong>
                </>
              ) : blockedByPending ? (
                <>
                  A deletion request is already pending for this project. Wait
                  for another admin to approve or reject it.
                </>
              ) : (
                <>
                  This will submit a deletion request for{" "}
                  <span className="font-mono">
                    {confirmDelete?.solutionName}
                  </span>
                  . Another admin must approve before the project is removed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {!dialogPending && needsAck && preflight && (
            <div className="flex items-start gap-2">
              <Checkbox
                id="ack-irreversible"
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                data-testid="checkbox-acknowledge-irreversible"
              />
              <Label htmlFor="ack-irreversible" className="text-sm">
                I understand this action is irreversible.
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              {dialogPending ? "Close" : "Cancel"}
            </Button>
            {dialogPending ? (
              confirmDelete?.pendingIsOwn ? (
                <Button
                  variant="destructive"
                  onClick={() =>
                    cancelReq.mutate({ id: dialogPending })
                  }
                  disabled={cancelReq.isPending}
                  data-testid="button-cancel-pending-delete"
                >
                  Cancel request
                </Button>
              ) : null
            ) : preflight ? (
              <Button
                variant="destructive"
                onClick={() =>
                  confirmDelete &&
                  remove.mutate({
                    data: {
                      slnPath: confirmDelete.slnPath,
                      ...(needsAck ? { acknowledgeIrreversible: true } : {}),
                    },
                  })
                }
                disabled={
                  remove.isPending ||
                  blockedByPending ||
                  (needsAck && !acknowledged)
                }
                data-testid="button-confirm-delete"
              >
                {needsAck ? "Delete permanently" : "Submit request"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmClear}
        onOpenChange={(o) => !o && setConfirmClear(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {clearDialogPending
                ? "Pending clear-files request"
                : clearNeedsAck
                ? "Clear project files?"
                : "Request to clear project files?"}
            </DialogTitle>
            <DialogDescription>
              {clearDialogPending ? (
                <>
                  A clear-files request is already pending for{" "}
                  <span className="font-mono">
                    {confirmClear?.solutionName}
                  </span>
                  . You can cancel it here.
                </>
              ) : clearPreflight === null ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking permissions…
                </span>
              ) : clearNeedsAck ? (
                <>
                  You are the only admin available to approve clearing the
                  files of{" "}
                  <span className="font-mono">
                    {confirmClear?.solutionName}
                  </span>
                  . Every recording and codegen output will be deleted from
                  disk — <strong>this cannot be undone.</strong> The
                  scaffolded skeleton is preserved.
                </>
              ) : clearBlockedByPending ? (
                <>
                  A clear-files request is already pending for this project.
                  Wait for another admin to approve or reject it.
                </>
              ) : (
                <>
                  This will submit a clear-files request for{" "}
                  <span className="font-mono">
                    {confirmClear?.solutionName}
                  </span>
                  . Another admin must approve before any files are removed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {!clearDialogPending && clearNeedsAck && clearPreflight && (
            <div className="flex items-start gap-2">
              <Checkbox
                id="ack-clear-irreversible"
                checked={clearAck}
                onCheckedChange={(v) => setClearAck(v === true)}
                data-testid="checkbox-acknowledge-clear-irreversible"
              />
              <Label htmlFor="ack-clear-irreversible" className="text-sm">
                I understand this action is irreversible.
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmClear(null)}>
              {clearDialogPending ? "Close" : "Cancel"}
            </Button>
            {clearDialogPending ? (
              confirmClear?.pendingIsOwn ? (
                <Button
                  variant="destructive"
                  onClick={() =>
                    cancelReq.mutate({ id: clearDialogPending })
                  }
                  disabled={cancelReq.isPending}
                  data-testid="button-cancel-pending-clear-files"
                >
                  Cancel request
                </Button>
              ) : null
            ) : clearPreflight ? (
              <Button
                variant={clearNeedsAck ? "destructive" : "default"}
                onClick={() =>
                  confirmClear &&
                  clearFiles.mutate({
                    data: {
                      slnPath: confirmClear.slnPath,
                      ...(clearNeedsAck
                        ? { acknowledgeIrreversible: true }
                        : {}),
                    },
                  })
                }
                disabled={
                  clearFiles.isPending ||
                  clearBlockedByPending ||
                  (clearNeedsAck && !clearAck)
                }
                data-testid="button-confirm-clear-files"
              >
                {clearNeedsAck ? "Clear permanently" : "Submit request"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

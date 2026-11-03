import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Check, X } from "lucide-react";
import {
  useListProjectLifecycleRequests,
  useApproveProjectLifecycleRequest,
  useRejectProjectLifecycleRequest,
  getListProjectLifecycleRequestsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";

type LifecycleKind = "create" | "delete" | "clear_files";

function kindLabel(k: LifecycleKind): string {
  if (k === "delete") return "Delete";
  if (k === "clear_files") return "Clear files";
  return "Create";
}

function approveConfirm(
  k: LifecycleKind,
  projectName: string,
): string | null {
  if (k === "delete") {
    return `This will permanently delete the project "${projectName}" — files and data. This cannot be undone. Approve?`;
  }
  if (k === "clear_files") {
    return `This will permanently clear every recording and codegen output from "${projectName}". The scaffolded skeleton stays. This cannot be undone. Approve?`;
  }
  return null;
}

export function LifecycleRequestsSection({
  viewerUserId,
  kind = "delete",
}: {
  viewerUserId: string | null | undefined;
  /**
   * Which lifecycle kind this queue renders. Defaults to "delete" so
   * existing callers (the "Pending deletions" section) are unchanged.
   */
  kind?: LifecycleKind;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useListProjectLifecycleRequests(
    { status: "pending" },
    { query: { queryKey: getListProjectLifecycleRequestsQueryKey({ status: "pending" }) } },
  );

  const refresh = async () => {
    await qc.invalidateQueries({
      queryKey: getListProjectLifecycleRequestsQueryKey(),
    });
    await qc.invalidateQueries({ queryKey: ["listAvailableProjects"] });
  };

  const approve = useApproveProjectLifecycleRequest({
    mutation: {
      onSuccess: async () => {
        toast.success("Request approved");
        await refresh();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to approve"),
    },
  });
  const reject = useRejectProjectLifecycleRequest({
    mutation: {
      onSuccess: async () => {
        toast.success("Request rejected");
        await refresh();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to reject"),
    },
  });

  // Each lifecycle queue (Pending deletions, Pending file clears, …)
  // renders only its own kind. Mixed-kind rendering would use the
  // wrong copy / destructive confirmation here.
  const rows = useMemo(
    () => (data ?? []).filter((r) => r.kind === kind),
    [data, kind],
  );

  if (isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  if (rows.length === 0) {
    const emptyText =
      kind === "delete"
        ? "No pending project deletion requests."
        : kind === "clear_files"
          ? "No pending clear-files requests."
          : "No pending project create requests.";
    return (
      <div
        className="text-center py-6 text-sm text-muted-foreground"
        data-testid={`empty-lifecycle-${kind}`}
      >
        {emptyText}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const isOwn = r.requestedByUserId === viewerUserId;
        return (
          <li
            key={r.id}
            className="rounded-md border border-border bg-card px-4 py-3 flex items-center justify-between gap-3"
            data-testid={`row-lifecycle-${r.id}`}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium font-mono">{r.projectName}</div>
              <div className="text-xs text-muted-foreground">
                {kindLabel(r.kind as LifecycleKind)} requested by{" "}
                {r.requestedByUsername} ({r.requestedByRole}) on{" "}
                {new Date(r.requestedAt).toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={isOwn || reject.isPending}
                title={isOwn ? "You cannot decide on your own request" : ""}
                onClick={() => reject.mutate({ id: r.id, data: {} })}
                data-testid={`button-reject-${r.id}`}
              >
                <X className="h-4 w-4 mr-1.5" />
                Reject
              </Button>
              <Button
                size="sm"
                disabled={isOwn || approve.isPending}
                title={isOwn ? "You cannot decide on your own request" : ""}
                onClick={() => {
                  const msg = approveConfirm(
                    r.kind as LifecycleKind,
                    r.projectName,
                  );
                  if (msg && !window.confirm(msg)) return;
                  approve.mutate({ id: r.id, data: {} });
                }}
                data-testid={`button-approve-${r.id}`}
              >
                <Check className="h-4 w-4 mr-1.5" />
                Approve
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

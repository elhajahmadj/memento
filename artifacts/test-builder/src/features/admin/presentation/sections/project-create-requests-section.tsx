import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import * as api from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";

export function ProjectCreateRequestsSection() {
  const qc = useQueryClient();
  const pendingQ = api.useListProjectLifecycleRequests(
    { status: "pending" },
    {
      query: {
        queryKey: api.getListProjectLifecycleRequestsQueryKey({
          status: "pending",
        }),
      },
    },
  );

  const invalidateAll = () => {
    void qc.invalidateQueries({
      queryKey: api.getListProjectLifecycleRequestsQueryKey(),
    });
    void qc.invalidateQueries({
      queryKey: api.getListAvailableProjectsQueryKey(),
    });
  };

  const approve = api.useApproveProjectLifecycleRequest({
    mutation: {
      onSuccess: () => {
        toast.success("Project request approved");
        invalidateAll();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to approve"),
    },
  });
  const reject = api.useRejectProjectLifecycleRequest({
    mutation: {
      onSuccess: () => {
        toast.success("Project request rejected");
        invalidateAll();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to reject"),
    },
  });

  const requests = (pendingQ.data ?? []).filter((r) => r.kind === "create");

  return (
    <section data-testid="section-project-create-requests">
      {pendingQ.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No pending project requests.
        </div>
      ) : (
        <ul
          className="space-y-2"
          data-testid="list-project-create-requests"
        >
          {requests.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3"
              data-testid={`row-project-create-request-${r.id}`}
            >
              <div className="min-w-0">
                <div className="font-medium">{r.projectName}</div>
                <div className="text-xs text-muted-foreground">
                  Requested by {r.requestedByUsername} ({r.requestedByRole}) ·{" "}
                  {new Date(r.requestedAt).toLocaleString()}
                </div>
                {(r.language || r.solutionType) && (
                  <div
                    className="text-xs text-muted-foreground mt-0.5"
                    data-testid={`row-project-create-request-${r.id}-tech`}
                  >
                    {r.language ?? "—"}
                    {r.solutionType ? ` · ${r.solutionType}` : ""}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  data-testid={`button-approve-create-${r.id}`}
                  onClick={() => approve.mutate({ id: r.id, data: {} })}
                  disabled={approve.isPending}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`button-reject-create-${r.id}`}
                  onClick={() => reject.mutate({ id: r.id, data: {} })}
                  disabled={reject.isPending}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

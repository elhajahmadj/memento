import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import * as forkApi from "@workspace/api-client-react";
import { useListAvailableProjects } from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";

export function ForkRequestsSection({ canAssign }: { canAssign: boolean }) {
  const qc = useQueryClient();
  const forksQ = useQuery({
    queryKey: ["forks", "list"],
    queryFn: () => forkApi.listForks(),
  });
  const usersQ = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => forkApi.listAdminUsers(),
  });
  const projectsQ = useListAvailableProjects({
    query: { queryKey: ["listAvailableProjectsForForks"] },
  });

  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedProject, setSelectedProject] = useState<string>("");

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["forks", "list"] });
  };

  const create = useMutation({
    mutationFn: (args: { userId: string; projectName: string }) =>
      forkApi.createForkAssignment(args),
    onSuccess: () => {
      toast.success("Fork created and assigned");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to create fork"),
  });
  const approve = useMutation({
    mutationFn: (id: string) => forkApi.approveFork(id),
    onSuccess: () => {
      toast.success("Fork approved");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to approve"),
  });
  const deny = useMutation({
    mutationFn: (id: string) => forkApi.denyFork(id),
    onSuccess: () => {
      toast.success("Fork request denied");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to deny"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => forkApi.deleteFork(id),
    onSuccess: () => {
      toast.success("Fork deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to delete fork"),
  });

  const limitedUsers = (usersQ.data ?? []).filter((u) => u.role === "limited");
  const projects = (projectsQ.data ?? []).filter((p) => !p.disabled);
  const forks = forksQ.data ?? [];
  const pending = forks.filter((f) => f.status === "pending");
  const active = forks.filter((f) => f.status === "active");

  return (
    <section data-testid="section-forks">
      {canAssign && (
      <div className="rounded-lg border border-border p-5 mb-6">
        <h3 className="font-medium mb-3">Assign a new fork</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>User</Label>
            <select
              data-testid="select-fork-user"
              className="bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
            >
              <option value="">Pick a user…</option>
              {limitedUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Project</Label>
            <select
              data-testid="select-fork-project"
              className="bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
            >
              <option value="">Pick a project…</option>
              {projects.map((p) => (
                <option key={p.solutionName} value={p.solutionName}>
                  {p.solutionName}
                </option>
              ))}
            </select>
          </div>
          <Button
            data-testid="button-create-fork"
            disabled={!selectedUser || !selectedProject || create.isPending}
            onClick={() =>
              create.mutate({
                userId: selectedUser,
                projectName: selectedProject,
              })
            }
          >
            {create.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Create fork
          </Button>
        </div>
      </div>
      )}

      <h3 className="font-medium mb-2">Pending requests</h3>
      {pending.length === 0 ? (
        <div className="text-sm text-muted-foreground mb-6">
          No pending requests.
        </div>
      ) : (
        <ul className="space-y-2 mb-6" data-testid="list-pending-forks">
          {pending.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3"
            >
              <div>
                <div className="font-medium">
                  {f.username} · {f.projectName}
                </div>
                <div className="text-xs text-muted-foreground">
                  Requested {new Date(f.requestedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  data-testid={`button-approve-${f.id}`}
                  onClick={() => approve.mutate(f.id)}
                  disabled={approve.isPending}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`button-deny-${f.id}`}
                  onClick={() => deny.mutate(f.id)}
                  disabled={deny.isPending}
                >
                  Deny
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="font-medium mb-2">Active forks</h3>
      {active.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No active forks yet.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="list-active-forks">
          {active.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {f.username} · {f.projectName}
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  {f.forkPath}
                </div>
              </div>
              {canAssign && (
              <Button
                size="sm"
                variant="outline"
                data-testid={`button-delete-fork-${f.id}`}
                onClick={() => {
                  if (
                    confirm(
                      `Delete fork for ${f.username}/${f.projectName}? This removes the directory and the assignment.`,
                    )
                  ) {
                    remove.mutate(f.id);
                  }
                }}
                disabled={remove.isPending}
              >
                <Trash2 className="h-4 w-4 mr-1.5" /> Delete
              </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

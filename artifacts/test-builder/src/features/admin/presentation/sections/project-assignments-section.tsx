import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import * as api from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";

export function ProjectAssignmentsSection() {
  return (
    <div>
      <AssignmentsSection />
      <AccessRequestsSection />
    </div>
  );
}

function AssignmentsSection() {
  const qc = useQueryClient();
  const assignmentsQ = api.useListProjectAssignments({
    query: { queryKey: api.getListProjectAssignmentsQueryKey() },
  });
  const usersQ = api.useListUsers({
    query: { queryKey: api.getListUsersQueryKey() },
  });
  const projectsQ = api.useListAvailableProjects({
    query: { queryKey: ["listAvailableProjectsForAssignments"] },
  });

  const [selectedUser, setSelectedUser] = useState("");
  const [selectedProject, setSelectedProject] = useState("");

  const invalidate = () => {
    void qc.invalidateQueries({
      queryKey: api.getListProjectAssignmentsQueryKey(),
    });
  };

  const create = api.useCreateProjectAssignment({
    mutation: {
      onSuccess: () => {
        toast.success("Assignment created");
        setSelectedUser("");
        setSelectedProject("");
        invalidate();
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to create assignment"),
    },
  });
  const remove = api.useRemoveProjectAssignment({
    mutation: {
      onSuccess: () => {
        toast.success("Assignment removed");
        invalidate();
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to remove assignment"),
    },
  });

  const limitedAdmins =
    (usersQ.data ?? []).filter((u) => u.role === "limited_admin");
  const projects = (projectsQ.data ?? []).filter((p) => !p.disabled);
  const assignments = assignmentsQ.data ?? [];
  const [groupBy, setGroupBy] = useState<"project" | "user">("project");

  const groupedByProject = new Map<string, typeof assignments>();
  const groupedByUser = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const byP = groupedByProject.get(a.projectName) ?? [];
    byP.push(a);
    groupedByProject.set(a.projectName, byP);
    const byU = groupedByUser.get(a.username) ?? [];
    byU.push(a);
    groupedByUser.set(a.username, byU);
  }
  const projectGroups = Array.from(groupedByProject.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const userGroups = Array.from(groupedByUser.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <section data-testid="section-assignments" className="mb-10">
      <div className="rounded-lg border border-border p-5 mb-6">
        <h3 className="font-medium mb-3">Create a new assignment</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Limited admin</Label>
            <select
              data-testid="select-assignment-user"
              className="bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
            >
              <option value="">Pick a user…</option>
              {limitedAdmins.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Project</Label>
            <select
              data-testid="select-assignment-project"
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
            data-testid="button-create-assignment"
            disabled={
              !selectedUser || !selectedProject || create.isPending
            }
            onClick={() =>
              create.mutate({
                data: {
                  userId: selectedUser,
                  projectName: selectedProject,
                },
              })
            }
          >
            {create.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Assign
          </Button>
        </div>
        {limitedAdmins.length === 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            No limited-admin users yet. Promote a user to "Limited admin" in
            Settings to assign them to projects.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium">Current assignments</h3>
        <div
          className="inline-flex rounded-md border border-border overflow-hidden"
          role="tablist"
          aria-label="Group assignments by"
        >
          <button
            role="tab"
            aria-selected={groupBy === "project"}
            data-testid="button-group-by-project"
            className={`px-3 py-1 text-xs ${
              groupBy === "project"
                ? "bg-muted text-foreground"
                : "bg-background text-muted-foreground"
            }`}
            onClick={() => setGroupBy("project")}
          >
            By project
          </button>
          <button
            role="tab"
            aria-selected={groupBy === "user"}
            data-testid="button-group-by-user"
            className={`px-3 py-1 text-xs border-l border-border ${
              groupBy === "user"
                ? "bg-muted text-foreground"
                : "bg-background text-muted-foreground"
            }`}
            onClick={() => setGroupBy("user")}
          >
            By limited admin
          </button>
        </div>
      </div>
      {assignmentsQ.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : assignments.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No project assignments yet.
        </div>
      ) : (
        <div
          className="space-y-4"
          data-testid={`list-project-assignments-by-${groupBy}`}
        >
          {(groupBy === "project" ? projectGroups : userGroups).map(
            ([groupKey, rows]) => (
              <div
                key={groupKey}
                className="rounded-md border border-border bg-card shadow-card"
                data-testid={`group-${groupBy}-${groupKey}`}
              >
                <div className="px-4 py-2 border-b border-border text-sm font-medium bg-muted/40">
                  {groupKey}
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({rows.length})
                  </span>
                </div>
                <ul>
                  {rows.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between px-4 py-2 border-b last:border-b-0 border-border"
                      data-testid={`row-assignment-${a.username}-${a.projectName}`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm">
                          {groupBy === "project" ? a.username : a.projectName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Assigned {new Date(a.assignedAt).toLocaleString()}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`button-remove-assignment-${a.username}-${a.projectName}`}
                        onClick={() => {
                          if (
                            confirm(
                              `Remove ${a.username} from ${a.projectName}? They will lose admin access to this project.`,
                            )
                          ) {
                            remove.mutate({
                              userId: a.userId,
                              projectName: a.projectName,
                            });
                          }
                        }}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-4 w-4 mr-1.5" /> Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function AccessRequestsSection() {
  const qc = useQueryClient();
  const pendingQ = api.useListProjectAccessRequests(
    { status: "pending" },
    { query: { queryKey: api.getListProjectAccessRequestsQueryKey({ status: "pending" }) } },
  );

  const invalidateAll = () => {
    void qc.invalidateQueries({
      queryKey: api.getListProjectAccessRequestsQueryKey({ status: "pending" }),
    });
    void qc.invalidateQueries({
      queryKey: api.getListProjectAssignmentsQueryKey(),
    });
  };

  const approve = api.useApproveProjectAccessRequest({
    mutation: {
      onSuccess: () => {
        toast.success("Access request approved");
        invalidateAll();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to approve"),
    },
  });
  const deny = api.useDenyProjectAccessRequest({
    mutation: {
      onSuccess: () => {
        toast.success("Access request denied");
        invalidateAll();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to deny"),
    },
  });

  const requests = pendingQ.data ?? [];

  return (
    <section data-testid="section-access-requests">
      <h3 className="font-medium mb-2">Pending access requests</h3>
      {pendingQ.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No pending requests.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="list-access-requests">
          {requests.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3"
              data-testid={`row-access-request-${r.id}`}
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {r.username} · {r.projectName}
                </div>
                <div className="text-xs text-muted-foreground">
                  Requested {new Date(r.requestedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  data-testid={`button-approve-access-${r.id}`}
                  onClick={() => approve.mutate({ id: r.id, data: {} })}
                  disabled={approve.isPending}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`button-deny-access-${r.id}`}
                  onClick={() => deny.mutate({ id: r.id, data: {} })}
                  disabled={deny.isPending}
                >
                  Deny
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

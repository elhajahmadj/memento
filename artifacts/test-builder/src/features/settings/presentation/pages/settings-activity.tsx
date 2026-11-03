import { Fragment, useState, useMemo } from "react";
import {
  useListAuditEvents,
  useListAvailableProjects,
  getListAuditEventsQueryKey,
  type AuditEvent,
  ListAuditEventsAction,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { formatDateTime as formatDate } from "@/shared/utils/format";

const LIFECYCLE_ACTIONS = new Set<string>([
  ListAuditEventsAction.project_create_requested,
  ListAuditEventsAction.project_create_approved,
  ListAuditEventsAction.project_create_rejected,
  ListAuditEventsAction.project_delete_requested,
  ListAuditEventsAction.project_delete_approved,
  ListAuditEventsAction.project_delete_rejected,
  ListAuditEventsAction.project_delete_executed,
]);

const APPROVAL_ACTIONS = new Set<string>([
  ListAuditEventsAction.project_create_approved,
  ListAuditEventsAction.project_create_rejected,
  ListAuditEventsAction.project_delete_approved,
  ListAuditEventsAction.project_delete_rejected,
  ListAuditEventsAction.project_delete_executed,
]);

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All actions" },
  { value: ListAuditEventsAction.file_create, label: "File created" },
  { value: ListAuditEventsAction.file_save, label: "File saved" },
  { value: ListAuditEventsAction.file_delete, label: "File deleted" },
  { value: ListAuditEventsAction.file_rename, label: "File renamed" },
  { value: ListAuditEventsAction.folder_create, label: "Folder created" },
  {
    value: ListAuditEventsAction.recording_finalize,
    label: "Recording finalized",
  },
  { value: ListAuditEventsAction.approval_submit, label: "Approval submitted" },
  { value: ListAuditEventsAction.approval_approve, label: "Approval approved" },
  { value: ListAuditEventsAction.approval_reject, label: "Approval rejected" },
  { value: ListAuditEventsAction.fork_create, label: "Fork created" },
  { value: ListAuditEventsAction.fork_delete, label: "Fork deleted" },
  { value: ListAuditEventsAction.role_change, label: "Role changed" },
  {
    value: ListAuditEventsAction.project_create_requested,
    label: "Project create requested",
  },
  {
    value: ListAuditEventsAction.project_create_approved,
    label: "Project create approved",
  },
  {
    value: ListAuditEventsAction.project_create_rejected,
    label: "Project create rejected",
  },
  {
    value: ListAuditEventsAction.project_delete_requested,
    label: "Project delete requested",
  },
  {
    value: ListAuditEventsAction.project_delete_approved,
    label: "Project delete approved",
  },
  {
    value: ListAuditEventsAction.project_delete_rejected,
    label: "Project delete rejected",
  },
  {
    value: ListAuditEventsAction.project_delete_executed,
    label: "Project delete executed",
  },
];

function formatActor(e: AuditEvent): string {
  const name = [e.firstName, e.lastName].filter(Boolean).join(" ").trim();
  if (name) return name;
  return e.username ?? e.userId.slice(0, 8);
}

function LifecycleDetails({
  event,
  "data-testid": testId,
}: {
  event: AuditEvent;
  "data-testid"?: string;
}) {
  const details = (event.details ?? {}) as Record<string, unknown>;
  const requestId =
    typeof details.requestId === "string" ? details.requestId : null;
  const requestedBy =
    typeof details.requestedBy === "string" ? details.requestedBy : null;
  const note = typeof details.note === "string" ? details.note : null;
  const cancelled = details.cancelled === true;
  const via = typeof details.via === "string" ? details.via : null;
  const isDecision = APPROVAL_ACTIONS.has(event.action);
  const decider = isDecision ? formatActor(event) : null;
  const rows: Array<[string, string]> = [];
  if (requestedBy) rows.push(["Requested by", requestedBy]);
  if (decider) rows.push(["Decided by", decider]);
  if (note) rows.push(["Decision note", note]);
  if (via) rows.push(["Via", via]);
  if (cancelled) rows.push(["Cancelled by requester", "yes"]);
  if (requestId) rows.push(["Request ID", requestId]);
  if (rows.length === 0) return null;
  return (
    <dl
      className="mb-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs"
      data-testid={testId}
    >
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono break-all">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function ActivitySection() {
  const [userFilter, setUserFilter] = useState("");
  const [userInput, setUserInput] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: available } = useListAvailableProjects({
    query: { queryKey: ["listAvailableProjects"] },
  });

  const params = useMemo(
    () => ({
      ...(userFilter ? { user: userFilter } : {}),
      ...(projectFilter !== "all" ? { project: projectFilter } : {}),
      ...(actionFilter !== "all"
        ? { action: actionFilter as (typeof ListAuditEventsAction)[keyof typeof ListAuditEventsAction] }
        : {}),
      page,
    }),
    [userFilter, projectFilter, actionFilter, page],
  );

  const { data, isLoading, isFetching } = useListAuditEvents(params, {
    query: {
      queryKey: getListAuditEventsQueryKey(params),
      placeholderData: (prev) => prev,
    },
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const applyUserFilter = () => {
    setUserFilter(userInput.trim());
    setPage(1);
  };

  return (
    <section data-testid="section-activity">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div className="space-y-1.5">
          <Label htmlFor="audit-user">User (username or id)</Label>
          <div className="flex gap-2">
            <Input
              id="audit-user"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyUserFilter();
              }}
              placeholder="e.g. alice"
              data-testid="input-audit-user"
            />
            <Button
              variant="outline"
              onClick={applyUserFilter}
              data-testid="button-audit-apply-user"
            >
              Apply
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Project</Label>
          <Select
            value={projectFilter}
            onValueChange={(v) => {
              setProjectFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger data-testid="select-audit-project">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {(available ?? []).map((p) => (
                <SelectItem key={p.slnPath} value={p.solutionName}>
                  {p.solutionName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Action</Label>
          <Select
            value={actionFilter}
            onValueChange={(v) => {
              setActionFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger data-testid="select-audit-action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 flex flex-col">
          <Label className="opacity-0">Reset</Label>
          <Button
            variant="ghost"
            onClick={() => {
              setUserFilter("");
              setUserInput("");
              setProjectFilter("all");
              setActionFilter("all");
              setPage(1);
            }}
            data-testid="button-audit-reset"
          >
            Clear filters
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : !data || data.events.length === 0 ? (
        <div
          className="text-center py-10 text-sm text-muted-foreground rounded-md border border-dashed border-border"
          data-testid="audit-empty"
        >
          No activity matches the current filters.
        </div>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 w-10"></th>
                <th className="text-left px-3 py-2 w-44">When</th>
                <th className="text-left px-3 py-2 w-44">User</th>
                <th className="text-left px-3 py-2 w-44">Project</th>
                <th className="text-left px-3 py-2 w-44">Action</th>
                <th className="text-left px-3 py-2">File</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => {
                const isOpen = expandedId === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr
                      className="border-t border-border hover:bg-muted/30 cursor-pointer"
                      onClick={() => setExpandedId(isOpen ? null : e.id)}
                      data-testid={`row-audit-${e.id}`}
                    >
                      <td className="px-3 py-2 text-muted-foreground">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatDate(e.createdAt)}
                      </td>
                      <td className="px-3 py-2">{formatActor(e)}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {e.project ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                      <td className="px-3 py-2 font-mono text-xs truncate max-w-[24rem]">
                        {e.filePath ?? ""}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-border bg-muted/20">
                        <td colSpan={6} className="px-3 py-3">
                          {LIFECYCLE_ACTIONS.has(e.action) ? (
                            <LifecycleDetails
                              event={e}
                              data-testid={`lifecycle-summary-${e.id}`}
                            />
                          ) : null}
                          <pre
                            className="text-xs font-mono bg-background border border-border rounded p-2 overflow-x-auto"
                            data-testid={`details-audit-${e.id}`}
                          >
                            {JSON.stringify(e.details ?? {}, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
        <div>
          {data
            ? `Showing page ${data.page} of ${totalPages} · ${data.total} event${
                data.total === 1 ? "" : "s"
              }`
            : ""}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || isFetching}
            data-testid="button-audit-prev"
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= totalPages || isFetching}
            data-testid="button-audit-next"
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}

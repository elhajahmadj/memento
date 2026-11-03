import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, GitFork, FileDiff, KeyRound, Trash2, Eraser } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import * as api from "@workspace/api-client-react";
import type {
  ForkDto,
  ApprovalSummaryDto,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Separator } from "@/shared/ui/separator";
import {
  useIsAdmin,
  useIsAnyAdmin,
  useIsLimitedAdmin,
} from "@/features/auth/presentation/role";

const POLL_MS = 30_000;

type SectionKey =
  | "forks"
  | "approvals"
  | "access"
  | "my-access"
  | "lifecycle-delete"
  | "lifecycle-clear-files";

type Section = {
  key: SectionKey;
  icon: typeof GitFork;
  label: string;
  count: number;
  href: string;
  emptyHint?: string;
  items: { id: string; primary: string; secondary?: string }[];
};

const SEEN_ACCESS_DECISION_KEY = "tb.limitedAdmin.seenAccessDecisions.v1";

export function NotificationBell() {
  const [, navigate] = useLocation();
  // Use the shared role hooks so `memento_admin` (god-mode super role)
  // is treated as admin everywhere — matches the Admin page's own
  // visibility for the lifecycle queues this bell links to.
  const isAdmin = useIsAdmin();
  const isLimitedAdmin = useIsLimitedAdmin();
  const isAnyAdmin = useIsAnyAdmin();

  const forksQuery = useQuery({
    queryKey: ["forks", "list", "notification-bell"],
    queryFn: () => api.listForks(),
    enabled: isAnyAdmin,
    refetchInterval: POLL_MS,
  });
  const approvalsQuery = useQuery({
    queryKey: ["approvals", "list", "pending", "notification-bell"],
    queryFn: () => api.listApprovals("pending"),
    enabled: isAnyAdmin,
    refetchInterval: POLL_MS,
  });
  const lifecycleRequestsQuery = api.useListProjectLifecycleRequests(
    { status: "pending" },
    {
      query: {
        queryKey: api.getListProjectLifecycleRequestsQueryKey({
          status: "pending",
        }),
        enabled: isAdmin,
        refetchInterval: POLL_MS,
      },
    },
  );
  const accessRequestsAdminQuery = api.useListProjectAccessRequests(
    { status: "pending" },
    {
      query: {
        queryKey: api.getListProjectAccessRequestsQueryKey({
          status: "pending",
        }),
        enabled: isAdmin,
        refetchInterval: POLL_MS,
      },
    },
  );
  // Limited admins see decisions on their own access requests so they
  // get a notification when an admin grants or denies them.
  const myAccessRequestsQuery = api.useListMyProjectAccessRequests({
    query: {
      queryKey: api.getListMyProjectAccessRequestsQueryKey(),
      enabled: isLimitedAdmin,
      refetchInterval: POLL_MS,
    },
  });

  // Fire a one-time toast for every newly-decided access request so a
  // limited admin notices the decision even if the bell popover is closed.
  const seenAccessDecisionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isLimitedAdmin) return;
    try {
      const raw = window.localStorage.getItem(SEEN_ACCESS_DECISION_KEY);
      if (raw) {
        seenAccessDecisionsRef.current = new Set(JSON.parse(raw) as string[]);
      }
    } catch {
      // ignore
    }
  }, [isLimitedAdmin]);
  useEffect(() => {
    if (!isLimitedAdmin) return;
    const data = myAccessRequestsQuery.data;
    if (!data) return;
    const seen = seenAccessDecisionsRef.current;
    let dirty = false;
    for (const r of data) {
      if (r.status === "pending") continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      dirty = true;
      if (r.status === "approved") {
        toast.success(`Access to ${r.projectName} approved`);
      } else if (r.status === "denied") {
        toast.error(
          r.note
            ? `Access to ${r.projectName} denied: ${r.note}`
            : `Access to ${r.projectName} denied`,
        );
      }
    }
    if (dirty) {
      try {
        window.localStorage.setItem(
          SEEN_ACCESS_DECISION_KEY,
          JSON.stringify(Array.from(seen)),
        );
      } catch {
        // ignore
      }
    }
  }, [isLimitedAdmin, myAccessRequestsQuery.data]);

  const sections = useMemo<Section[]>(() => {
    const built: Section[] = [];
    if (isAnyAdmin) {
      const pendingForks: ForkDto[] = (forksQuery.data ?? []).filter(
        (f) => f.status === "pending",
      );
      built.push({
        key: "forks",
        icon: GitFork,
        label: "Fork requests",
        count: pendingForks.length,
        href: "/admin/fork-requests",
        items: pendingForks.slice(0, 5).map((f) => ({
          id: f.id,
          primary: f.projectName,
          secondary: f.username,
        })),
      });
      const pendingApprovals: ApprovalSummaryDto[] = approvalsQuery.data ?? [];
      built.push({
        key: "approvals",
        icon: FileDiff,
        label: "Code change requests",
        count: pendingApprovals.length,
        href: "/admin/approval",
        items: pendingApprovals.slice(0, 5).map((a) => ({
          id: a.id,
          primary: a.projectName,
          secondary: a.username,
        })),
      });
    }
    if (isAdmin) {
      const pendingLifecycle = lifecycleRequestsQuery.data ?? [];
      const pendingDeletes = pendingLifecycle.filter(
        (r) => r.kind === "delete",
      );
      built.push({
        key: "lifecycle-delete",
        icon: Trash2,
        label: "Pending deletions",
        count: pendingDeletes.length,
        href: "/admin#lifecycle-requests",
        items: pendingDeletes.slice(0, 5).map((r) => ({
          id: r.id,
          primary: r.projectName,
          secondary: r.requestedByUsername,
        })),
      });
      const pendingClears = pendingLifecycle.filter(
        (r) => r.kind === "clear_files",
      );
      built.push({
        key: "lifecycle-clear-files",
        icon: Eraser,
        label: "Pending file clears",
        count: pendingClears.length,
        href: "/admin#lifecycle-requests-clear-files",
        items: pendingClears.slice(0, 5).map((r) => ({
          id: r.id,
          primary: r.projectName,
          secondary: r.requestedByUsername,
        })),
      });
      const pendingAccess = accessRequestsAdminQuery.data ?? [];
      built.push({
        key: "access",
        icon: KeyRound,
        label: "Project access requests",
        count: pendingAccess.length,
        href: "/admin/project-assignments",
        items: pendingAccess.slice(0, 5).map((r) => ({
          id: r.id,
          primary: `${r.username} → ${r.projectName}`,
        })),
      });
    }
    if (isLimitedAdmin) {
      const pendingMine = (myAccessRequestsQuery.data ?? []).filter(
        (r) => r.status === "pending",
      );
      built.push({
        key: "my-access",
        icon: KeyRound,
        label: "My pending access requests",
        count: pendingMine.length,
        href: "/",
        items: pendingMine.slice(0, 5).map((r) => ({
          id: r.id,
          primary: r.projectName,
        })),
      });
    }
    return built;
  }, [
    isAdmin,
    isAnyAdmin,
    isLimitedAdmin,
    forksQuery.data,
    approvalsQuery.data,
    lifecycleRequestsQuery.data,
    accessRequestsAdminQuery.data,
    myAccessRequestsQuery.data,
  ]);

  if (!isAnyAdmin) return null;

  const total = sections.reduce((s, x) => s + x.count, 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            total > 0 ? `${total} pending notifications` : "Notifications"
          }
          title={total > 0 ? `${total} pending` : "Notifications"}
          data-testid="button-notifications"
        >
          <Bell className="h-4 w-4" />
          {total > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center leading-none"
              data-testid="badge-notification-count"
            >
              {total > 99 ? "99+" : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        data-testid="popover-notifications"
      >
        <div className="px-3 py-2 flex items-center justify-between">
          <div className="text-sm font-medium">Notifications</div>
          <div className="text-xs text-muted-foreground">
            {total === 0 ? "All caught up" : `${total} pending`}
          </div>
        </div>
        <Separator />
        <ScrollArea className="max-h-96">
          {sections.map((section, idx) => {
            const Icon = section.icon;
            return (
              <div key={section.key}>
                {idx > 0 && <Separator />}
                <button
                  type="button"
                  onClick={() => navigate(section.href)}
                  className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors flex items-center gap-2"
                  data-testid={`notification-section-${section.key}`}
                >
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 text-sm">{section.label}</div>
                  <span
                    className={
                      "text-xs rounded-full px-2 py-0.5 " +
                      (section.count > 0
                        ? "bg-destructive text-destructive-foreground font-medium"
                        : "bg-muted text-muted-foreground")
                    }
                  >
                    {section.count}
                  </span>
                </button>
                {section.count > 0 && (
                  <ul className="pb-2">
                    {section.items.map((it) => (
                      <li
                        key={it.id}
                        className="px-3 py-1.5 pl-9 text-xs text-muted-foreground truncate"
                      >
                        <span className="text-foreground">{it.primary}</span>
                        {it.secondary && (
                          <span className="ml-1 opacity-70">
                            — {it.secondary}
                          </span>
                        )}
                      </li>
                    ))}
                    {section.count > section.items.length && (
                      <li className="px-3 py-1 pl-9 text-xs text-muted-foreground italic">
                        +{section.count - section.items.length} more…
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

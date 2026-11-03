import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History as HistoryIcon, Undo2, ChevronDown, ChevronRight } from "lucide-react";
import {
  useGetRecordingEditHistory,
  getGetRecordingEditHistoryQueryKey,
} from "@workspace/api-client-react";
import type { AuditEvent } from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Badge } from "@/shared/ui/badge";
import { useIsAnyAdmin } from "@/features/auth/presentation/role";

/**
 * Per-recording History panel — lists every `recorded_action_edit`
 * audit row written for the active session and lets admins one-click
 * revert each one through the existing recording WebSocket.
 *
 * Visibility mirrors the `/audit` page (admin / limited_admin only) and
 * the panel is also conditionally mounted in `right-panel.tsx` so it
 * never shows up outside of an in-progress / stopped recording.
 *
 * Revert paths are intentionally synchronous: each row maps to one of
 * the existing `recorder:request-*` window events (`delete-action`,
 * `undelete-action(s)`, `edit-action-value`, `move-action`). The
 * server-side handlers already guard out-of-range / already-deleted
 * indices, so a stale revert (e.g. after the user manually deleted the
 * row) just gets a quiet no-op + error broadcast.
 */
export function HistoryPanel({
  recording,
  stopped,
}: {
  recording: boolean;
  stopped: boolean;
}) {
  const isAdmin = useIsAnyAdmin();
  const active = recording || stopped;
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  // Refetch periodically so a teammate's edits surface in the panel
  // without forcing the user to reopen the workbench. Server endpoint
  // is admin-only and scoped to the caller's session, so the polling
  // cost is bounded.
  const { data, isLoading } = useGetRecordingEditHistory({
    query: {
      queryKey: getGetRecordingEditHistoryQueryKey(),
      enabled: isAdmin && active,
      refetchInterval: isAdmin && active ? 4000 : false,
      staleTime: 1500,
    },
  });
  const events = useMemo<AuditEvent[]>(() => data?.events ?? [], [data]);

  if (!isAdmin || !active) return null;

  const refetchSoon = () => {
    setTimeout(() => {
      queryClient.invalidateQueries({
        queryKey: getGetRecordingEditHistoryQueryKey(),
      });
    }, 250);
  };

  return (
    <div
      className="border-t border-sidebar-border flex flex-col min-h-0"
      data-testid="recording-history-panel"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="h-9 w-full flex items-center px-3 text-xs font-mono uppercase tracking-wider text-muted-foreground hover-elevate"
        data-testid="button-toggle-history"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 mr-1.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 mr-1.5" />
        )}
        <HistoryIcon className="h-3.5 w-3.5 mr-2" />
        History
        <Badge
          variant="secondary"
          className="ml-2 h-4 text-[10px] px-1.5"
          data-testid="badge-history-count"
        >
          {events.length}
        </Badge>
        {isLoading && events.length === 0 && (
          <span className="ml-2 text-[10px] normal-case">loading…</span>
        )}
      </button>
      {!collapsed && (
        <ScrollArea className="max-h-48">
          <div className="p-2 space-y-1">
            {events.length === 0 ? (
              <div
                className="text-xs text-muted-foreground px-2 py-3"
                data-testid="text-history-empty"
              >
                No edits yet — moves, edits, deletes, and inserted
                assertions will show up here.
              </div>
            ) : (
              events.map((ev) => (
                <HistoryRow key={ev.id} ev={ev} onReverted={refetchSoon} />
              ))
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

interface OperationDescriptor {
  /** Short verb + target shown in the row body. */
  label: string;
  /** True if we know how to revert this operation client-side. */
  revertible: boolean;
  /** Human-friendly hint for the Revert button's tooltip. */
  revertHint: string;
}

const FIELD_LABELS: Record<string, string> = {
  value: "value",
  url: "url",
  assertText: "expected text",
  assertUrl: "expected url",
  assertCount: "expected count",
  assertAttrValue: "expected attribute",
  assertValue: "expected value",
  assertStatusCode: "status code",
};

function describeOperation(ev: AuditEvent): OperationDescriptor {
  const d = ev.details as Record<string, unknown>;
  const op = typeof d.operation === "string" ? d.operation : "edit";
  switch (op) {
    case "add-assertion": {
      const kind = typeof d.assertKind === "string" ? d.assertKind : "assertion";
      return {
        label: `Added ${kind} assertion`,
        revertible: typeof d.index === "number",
        revertHint: "Delete the assertion that was added",
      };
    }
    case "insert-assertion": {
      const kind = typeof d.assertKind === "string" ? d.assertKind : "assertion";
      return {
        label: `Inserted ${kind} assertion`,
        revertible: typeof d.insertedAt === "number",
        revertHint: "Delete the assertion that was inserted",
      };
    }
    case "move-action": {
      const dir = d.direction === "up" || d.direction === "down" ? d.direction : null;
      return {
        label: `Moved step ${dir ?? "" }`.trim(),
        revertible: typeof d.from === "number" && typeof d.to === "number" && dir !== null,
        revertHint: "Move the step back to its previous position",
      };
    }
    case "duplicate-action": {
      return {
        label: "Duplicated step",
        revertible: typeof d.inserted === "number",
        revertHint: "Delete the duplicate",
      };
    }
    case "edit-action-value": {
      const field = typeof d.field === "string" ? d.field : "";
      const fieldLabel = FIELD_LABELS[field] ?? field ?? "value";
      return {
        label: `Edited ${fieldLabel}`,
        revertible:
          typeof d.index === "number" &&
          typeof field === "string" &&
          d.previousValue !== undefined,
        revertHint: "Restore the previous value",
      };
    }
    case "delete-action": {
      return {
        label: "Deleted step",
        revertible: typeof d.index === "number",
        revertHint: "Restore the deleted step",
      };
    }
    case "delete-actions": {
      const indices = Array.isArray(d.indices) ? d.indices : [];
      return {
        label:
          indices.length === 1
            ? "Deleted 1 step"
            : `Deleted ${indices.length} steps`,
        revertible: indices.length > 0,
        revertHint: "Restore the deleted steps",
      };
    }
    default:
      return {
        label: op,
        revertible: false,
        revertHint: "Cannot revert this operation",
      };
  }
}

function actorName(ev: AuditEvent): string {
  const first = ev.firstName?.trim();
  const last = ev.lastName?.trim();
  if (first || last) return `${first ?? ""} ${last ?? ""}`.trim();
  if (ev.username) return ev.username;
  return "Unknown";
}

function actorInitial(ev: AuditEvent): string {
  const name = actorName(ev);
  return name.charAt(0).toUpperCase() || "?";
}

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function HistoryRow({
  ev,
  onReverted,
}: {
  ev: AuditEvent;
  onReverted: () => void;
}) {
  const desc = describeOperation(ev);
  const actor = actorName(ev);
  const dispatchRevert = () => {
    const ok = applyRevert(ev);
    if (ok) {
      toast.success("Revert sent");
      onReverted();
    } else {
      toast.error("Cannot revert this entry");
    }
  };
  return (
    <div
      className="flex items-start gap-2 px-2 py-1.5 rounded-sm hover-elevate"
      data-testid={`row-history-${ev.id}`}
    >
      <div
        className="h-5 w-5 shrink-0 rounded-full bg-muted text-[10px] font-medium flex items-center justify-center text-muted-foreground"
        title={actor}
      >
        {actorInitial(ev)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs truncate">
          <span className="font-medium">{actor}</span>{" "}
          <span className="text-muted-foreground">{desc.label}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {timeAgo(ev.createdAt)}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[11px]"
        onClick={dispatchRevert}
        disabled={!desc.revertible}
        title={desc.revertHint}
        data-testid={`button-revert-${ev.id}`}
      >
        <Undo2 className="h-3 w-3 mr-1" />
        Revert
      </Button>
    </div>
  );
}

/**
 * Map an audit row to the inverse `recorder:request-*` event and fire
 * it. Returns false when the row is missing data needed for revert
 * (older rows without `previousValue`, malformed details, etc).
 */
function applyRevert(ev: AuditEvent): boolean {
  const d = ev.details as Record<string, unknown>;
  const op = typeof d.operation === "string" ? d.operation : "";
  switch (op) {
    case "add-assertion": {
      if (typeof d.index !== "number") return false;
      window.dispatchEvent(
        new CustomEvent("recorder:request-delete", {
          detail: { index: d.index },
        }),
      );
      return true;
    }
    case "insert-assertion": {
      if (typeof d.insertedAt !== "number") return false;
      window.dispatchEvent(
        new CustomEvent("recorder:request-delete", {
          detail: { index: d.insertedAt },
        }),
      );
      return true;
    }
    case "duplicate-action": {
      if (typeof d.inserted !== "number") return false;
      window.dispatchEvent(
        new CustomEvent("recorder:request-delete", {
          detail: { index: d.inserted },
        }),
      );
      return true;
    }
    case "move-action": {
      if (
        typeof d.from !== "number" ||
        typeof d.to !== "number" ||
        (d.direction !== "up" && d.direction !== "down")
      ) {
        return false;
      }
      // After the swap the moved action lives at `to`. Sending the
      // opposite direction asks the server to swap it back into `from`.
      const reverse = d.direction === "up" ? "down" : "up";
      window.dispatchEvent(
        new CustomEvent("recorder:request-move-action", {
          detail: { index: d.to, direction: reverse },
        }),
      );
      return true;
    }
    case "edit-action-value": {
      const idx = d.index;
      const field = d.field;
      const prev = d.previousValue;
      if (
        typeof idx !== "number" ||
        typeof field !== "string" ||
        prev === undefined
      ) {
        return false;
      }
      const detail: Record<string, unknown> = { index: idx, [field]: prev };
      window.dispatchEvent(
        new CustomEvent("recorder:request-edit-action", { detail }),
      );
      return true;
    }
    case "delete-action": {
      if (typeof d.index !== "number") return false;
      window.dispatchEvent(
        new CustomEvent("recorder:request-undelete-action", {
          detail: { index: d.index },
        }),
      );
      return true;
    }
    case "delete-actions": {
      const indices = Array.isArray(d.indices)
        ? (d.indices as unknown[]).filter(
            (v): v is number => typeof v === "number",
          )
        : [];
      if (indices.length === 0) return false;
      window.dispatchEvent(
        new CustomEvent("recorder:request-undelete-actions", {
          detail: { indices },
        }),
      );
      return true;
    }
    default:
      return false;
  }
}

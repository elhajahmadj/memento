import { toast } from "sonner";
import type { MutableRefObject } from "react";
import type { RecordedActionMsg } from "@/features/workbench/domain/types";
import type {
  NamePromptItem,
  RecordingLanguage,
  UndoEntry,
} from "./types";

export type EventForwarderCtx = {
  wsRef: MutableRefObject<WebSocket | null>;
  undoStackRef: MutableRefObject<UndoEntry[]>;
  bulkDeletingRef: MutableRefObject<Set<number>>;
  bulkToastsRef: MutableRefObject<Map<string, number[]>>;
  enqueueNamePromptRef: MutableRefObject<(item: NamePromptItem) => void>;
  recCanvasLanguageRef: MutableRefObject<RecordingLanguage>;
  /** Re-emitted so existing tests / consumers stay quiet. */
  actionCacheRef?: MutableRefObject<Map<number, RecordedActionMsg>>;
};

function sendIfOpen(
  ws: MutableRefObject<WebSocket | null>,
  payload: unknown,
): boolean {
  if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
    toast.error("Not connected — try again in a moment.");
    return false;
  }
  ws.current.send(JSON.stringify(payload));
  return true;
}

/**
 * Subscribes to all `recorder:request-*` window events fired by the
 * other workbench panels and forwards them to the recording
 * WebSocket. Also wires the Cmd/Ctrl+Z LIFO undo keyboard shortcut.
 * Returns a cleanup function that removes every listener.
 */
export function installEventForwarders(ctx: EventForwarderCtx): () => void {
  const {
    wsRef,
    undoStackRef,
    bulkDeletingRef,
    bulkToastsRef,
    enqueueNamePromptRef,
    recCanvasLanguageRef,
  } = ctx;

  const renameHandler = (ev: Event) => {
    const e = ev as CustomEvent<{
      index: number;
      currentName: string;
      actionType: string;
      decoratedSuggestion?: string;
    }>;
    enqueueNamePromptRef.current({
      index: e.detail.index,
      suggested: e.detail.currentName,
      actionType: e.detail.actionType,
      decoratedSuggestion: e.detail.decoratedSuggestion,
      language: recCanvasLanguageRef.current,
    });
  };

  const deleteHandler = (ev: Event) => {
    const e = ev as CustomEvent<{ index: number }>;
    if (!wsRef.current) return;
    wsRef.current.send(
      JSON.stringify({ type: "delete-action", index: e.detail.index }),
    );
  };

  const deleteBulkHandler = (ev: Event) => {
    const e = ev as CustomEvent<{ indices: number[] }>;
    if (!wsRef.current) return;
    const indices = Array.isArray(e.detail?.indices) ? e.detail.indices : [];
    if (indices.length === 0) return;
    // Mark every index so the per-row `actionDeleted` handler skips
    // its single-undo toast — the aggregated one below covers them.
    for (const i of indices) bulkDeletingRef.current.add(i);
    wsRef.current.send(JSON.stringify({ type: "delete-actions", indices }));
    const batch = indices.slice();
    const toastId = `undo-bulk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    bulkToastsRef.current.set(toastId, batch);
    const label =
      batch.length === 1 ? "1 action deleted" : `${batch.length} actions deleted`;
    toast(label, {
      id: toastId,
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          // Read the current set — manual single-undos may have
          // already restored some entries; only re-restore what's
          // still pending in this batch.
          const remaining = bulkToastsRef.current.get(toastId) ?? [];
          bulkToastsRef.current.delete(toastId);
          if (
            remaining.length > 0 &&
            wsRef.current &&
            wsRef.current.readyState === WebSocket.OPEN
          ) {
            wsRef.current.send(
              JSON.stringify({
                type: "undelete-actions",
                indices: remaining,
              }),
            );
          }
          // Drop these delete entries from the LIFO undo stack so a
          // follow-up Cmd/Ctrl+Z doesn't try to re-restore them.
          // Rename entries are unaffected (a different kind of edit).
          const restored = new Set(remaining);
          undoStackRef.current = undoStackRef.current.filter(
            (e) => !(e.kind === "delete" && restored.has(e.index)),
          );
        },
      },
    });
  };

  // Cmd/Ctrl+Z while the recording panel is mounted undoes the most
  // recent in-session deletion. Captured at window level (capture phase)
  // so we beat element-level handlers — notably the fallback keystroke
  // input, which otherwise forwards every keypress to the page. Skipped
  // for real text-entry controls (the name-prompt input, etc.) so native
  // text-undo there is preserved; the recorder's keystroke input is
  // explicitly opted into the shortcut via its data-testid.
  const undoKeyHandler = (ev: KeyboardEvent) => {
    const isUndo =
      (ev.metaKey || ev.ctrlKey) &&
      !ev.shiftKey &&
      !ev.altKey &&
      (ev.key === "z" || ev.key === "Z");
    if (!isUndo) return;
    const target = ev.target as HTMLElement | null;
    if (target) {
      const isRecorderKeyInput =
        target.getAttribute?.("data-testid") === "input-recording-keys";
      if (!isRecorderKeyInput) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
      }
    }
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    if (entry.kind === "delete") {
      wsRef.current.send(
        JSON.stringify({ type: "undelete-action", index: entry.index }),
      );
    } else {
      wsRef.current.send(
        JSON.stringify({ type: "undo-name-action", index: entry.index }),
      );
    }
  };

  // Forward add-assertion requests from the RightPanel dialog through
  // the existing recording WebSocket so the server can append the
  // assertion to the session, broadcast it to the actions feed, and
  // re-render the C# body preview using the same path as recorded
  // actions.
  const addAssertionHandler = (ev: Event) => {
    const e = ev as CustomEvent<{
      assertKind:
        | "element-has-text"
        | "url-contains"
        | "url-equals"
        | "accessibility"
        | "visual-baseline"
        | "element-visible"
        | "element-hidden"
        | "element-count-equals"
        | "attribute-equals"
        | "value-equals"
        | "response-status";
      selector?: string;
      assertText?: string;
      assertUrl?: string;
      axeImpactLevel?: "minor" | "moderate" | "serious" | "critical";
      visualName?: string;
      visualThreshold?: number;
      assertCount?: number;
      assertAttribute?: string;
      assertAttrValue?: string;
      assertValue?: string;
      assertStatusCode?: number;
    }>;
    sendIfOpen(wsRef, { type: "add-assertion", ...e.detail });
  };

  const moveActionHandler = (ev: Event) => {
    const e = ev as CustomEvent<{ index: number; direction: "up" | "down" }>;
    sendIfOpen(wsRef, {
      type: "move-action",
      index: e.detail.index,
      direction: e.detail.direction,
    });
  };

  const duplicateActionHandler = (ev: Event) => {
    const e = ev as CustomEvent<{ index: number }>;
    sendIfOpen(wsRef, { type: "duplicate-action", index: e.detail.index });
  };

  const editActionHandler = (ev: Event) => {
    const e = ev as CustomEvent<Record<string, unknown>>;
    sendIfOpen(wsRef, { type: "edit-action-value", ...e.detail });
  };

  // Generic single / bulk un-delete dispatcher used by the History
  // panel's Revert button. The Cmd/Ctrl+Z LIFO above writes to the
  // socket directly because it owns the undo stack — these handlers
  // exist so any consumer (revert UI, future shortcuts) can fire the
  // same WS messages without reaching into wsRef.
  const undeleteHandler = (ev: Event) => {
    const e = ev as CustomEvent<{ index: number }>;
    sendIfOpen(wsRef, { type: "undelete-action", index: e.detail.index });
  };

  const undeleteBulkHandler = (ev: Event) => {
    const e = ev as CustomEvent<{ indices: number[] }>;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast.error("Not connected — try again in a moment.");
      return;
    }
    const indices = Array.isArray(e.detail?.indices) ? e.detail.indices : [];
    if (indices.length === 0) return;
    wsRef.current.send(JSON.stringify({ type: "undelete-actions", indices }));
  };

  const addApiAssertionHandler = (ev: Event) => {
    const e = ev as CustomEvent<{
      apiMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      apiUrl: string;
      apiExpectedStatus: number;
      apiRequestBody?: string;
    }>;
    sendIfOpen(wsRef, { type: "add-api-assertion", ...e.detail });
  };

  // Forward add-wait requests from the AddWaitDialog through the same
  // recording WebSocket so the server can append a wait step to the
  // session, broadcast it to the actions feed, and refresh the body
  // preview with the corresponding `await page.waitFor*` line.
  const addWaitHandler = (ev: Event) => {
    const e = ev as CustomEvent<{
      waitKind: "selector" | "networkidle" | "timeout";
      waitSelector?: string;
      waitMs?: number;
    }>;
    sendIfOpen(wsRef, { type: "add-wait", ...e.detail });
  };

  // T003 — splice a saved RecordedAction macro into the live session.
  // `atIndex` is optional; when omitted the server appends at the end.
  const insertSharedStepHandler = (ev: Event) => {
    const e = ev as CustomEvent<{ name: string; atIndex?: number }>;
    const payload: {
      type: "insert-shared-step";
      name: string;
      atIndex?: number;
    } = { type: "insert-shared-step", name: e.detail.name };
    if (typeof e.detail.atIndex === "number") {
      payload.atIndex = e.detail.atIndex;
    }
    sendIfOpen(wsRef, payload);
  };

  const subscriptions: Array<[string, EventListener]> = [
    ["recorder:request-rename", renameHandler as EventListener],
    ["recorder:request-delete", deleteHandler as EventListener],
    ["recorder:request-delete-bulk", deleteBulkHandler as EventListener],
    ["recorder:request-add-assertion", addAssertionHandler as EventListener],
    ["recorder:request-move-action", moveActionHandler as EventListener],
    [
      "recorder:request-duplicate-action",
      duplicateActionHandler as EventListener,
    ],
    ["recorder:request-edit-action", editActionHandler as EventListener],
    ["recorder:request-undelete-action", undeleteHandler as EventListener],
    [
      "recorder:request-undelete-actions",
      undeleteBulkHandler as EventListener,
    ],
    [
      "recorder:request-add-api-assertion",
      addApiAssertionHandler as EventListener,
    ],
    ["recorder:request-add-wait", addWaitHandler as EventListener],
    [
      "recorder:request-insert-shared-step",
      insertSharedStepHandler as EventListener,
    ],
  ];

  for (const [name, fn] of subscriptions) {
    window.addEventListener(name, fn);
  }
  window.addEventListener("keydown", undoKeyHandler, true);

  return () => {
    for (const [name, fn] of subscriptions) {
      window.removeEventListener(name, fn);
    }
    window.removeEventListener("keydown", undoKeyHandler, true);
  };
}

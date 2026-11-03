import { toast } from "sonner";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  FrameMsg,
  RecordedActionMsg,
} from "@/features/workbench/domain/types";
import { defaultFillNameForLanguage } from "./noun-helpers";
import type {
  FillPromptState,
  NamePromptItem,
  RecordingLanguage,
  UndoEntry,
} from "./types";

export type MessageHandlerCtx = {
  recCanvasLanguageRef: MutableRefObject<RecordingLanguage>;
  setFrame: Dispatch<SetStateAction<FrameMsg | null>>;
  setLiveUrl: Dispatch<SetStateAction<string>>;
  setFillPrompt: Dispatch<SetStateAction<FillPromptState | null>>;
  setFillValue: Dispatch<SetStateAction<string>>;
  setFillNameValue: Dispatch<SetStateAction<string>>;
  setNamePrompt: Dispatch<SetStateAction<NamePromptItem | null>>;
  setNameValue: Dispatch<SetStateAction<string>>;
  wsRef: MutableRefObject<WebSocket | null>;
  undoStackRef: MutableRefObject<UndoEntry[]>;
  actionCacheRef: MutableRefObject<Map<number, RecordedActionMsg>>;
  bulkDeletingRef: MutableRefObject<Set<number>>;
  bulkToastsRef: MutableRefObject<Map<string, number[]>>;
  nameQueueRef: MutableRefObject<NamePromptItem[]>;
  enqueueNamePromptRef: MutableRefObject<(item: NamePromptItem) => void>;
  /**
   * Called when the server replies with `{type: "error"}` so the
   * caller can mark the connection as intentionally closed and clear
   * any pending reconnect timer.
   */
  abortReconnect: () => void;
};

type Msg = Record<string, unknown> & { type: string };
type Handler = (ctx: MessageHandlerCtx, msg: Msg) => void;

const handleError: Handler = (ctx) => {
  ctx.abortReconnect();
};

const handleFrame: Handler = (ctx, msg) => {
  ctx.setFrame(msg as unknown as FrameMsg);
};

const handleAction: Handler = (ctx, msg) => {
  // A new action invalidates any pending bulk-undo toasts —
  // restoring would re-insert deleted rows behind the new one
  // and produce a stale-looking sequence. Drop those indices
  // from the Cmd/Ctrl+Z undo stack as well so the keyboard
  // shortcut can't sneak the same stale restore through after
  // the toast is gone. Per-row single-undo toasts are left
  // alone (those are user-facing affordances for accidental
  // clicks and remain valid until they expire).
  if (ctx.bulkToastsRef.current.size > 0) {
    const stale = new Set<number>();
    for (const [id, idxs] of ctx.bulkToastsRef.current) {
      toast.dismiss(id);
      for (const i of idxs) stale.add(i);
    }
    ctx.bulkToastsRef.current.clear();
    if (stale.size > 0) {
      // Only the bulk-delete entries are invalidated by a new
      // action; rename undos for the same indices stay valid
      // because the row is still present.
      ctx.undoStackRef.current = ctx.undoStackRef.current.filter(
        (e) => e.kind !== "delete" || !stale.has(e.index),
      );
    }
  }
  const a = msg.action as RecordedActionMsg;
  if (a.url) ctx.setLiveUrl(a.url);
  // Decorate the action with server-assigned index/suggested name so
  // the ActionsFeed (and the name prompt below) can use them.
  // For C# the server also sends `suggestedNoun` (prompt pre-fill)
  // and `decoratedMethodName` (display form). Both are absent for
  // Python/Node and the feed falls back to `suggestedMethodName`.
  const suggestedNoun =
    typeof msg.suggestedNoun === "string" ? msg.suggestedNoun : null;
  const decoratedMethodName =
    typeof msg.decoratedMethodName === "string"
      ? msg.decoratedMethodName
      : null;
  const decorated: RecordedActionMsg = {
    ...a,
    index: typeof msg.index === "number" ? msg.index : undefined,
    suggestedMethodName:
      typeof msg.suggestedMethodName === "string"
        ? msg.suggestedMethodName
        : null,
    suggestedNoun,
    decoratedMethodName,
  };
  // When the click landed on a text-entry control, open a prompt
  // asking the user what to type. Submitting sends one `fill`
  // command to the server; cancelling does nothing. The server's
  // synthetic fill action that follows will trigger the name prompt
  // — so for one editable click the user sees value-then-name in a
  // single chained flow, never two stacked dialogs.
  if (a.type === "click" && a.editable && a.selector) {
    ctx.setFillValue("");
    // Seed the combined dialog's name field with a sensible
    // language-aware default derived from the editable element's
    // label (testid / id / aria-label / name / placeholder).
    // The server will silently override the suggestion later if
    // it has a better one once the synthetic fill is recorded.
    ctx.setFillNameValue(
      defaultFillNameForLanguage(
        a.editable.label,
        ctx.recCanvasLanguageRef.current,
      ),
    );
    ctx.setFillPrompt({
      label: a.editable.label,
      kind: a.editable.kind,
      selector: a.selector,
    });
  } else if (
    typeof msg.suggestedMethodName === "string" &&
    typeof msg.index === "number" &&
    a.type !== "navigate" &&
    // Combined fill+name dialog: when the server has already
    // applied the user-supplied method name to the synthetic
    // fill (broadcast carries `methodName`), skip enqueuing a
    // standalone "Name this action" prompt for that fill.
    typeof msg.methodName !== "string"
  ) {
    // Non-navigate actions that produce a method get a name prompt.
    // For noun-flow languages (C# / Python / Node.js) we pre-fill
    // the input with the bare noun and seed the live preview from
    // the decorated form. Java uses the legacy single-field
    // pre-fill (no live preview shown).
    ctx.enqueueNamePromptRef.current({
      index: msg.index,
      suggested: suggestedNoun ?? (msg.suggestedMethodName as string),
      actionType: a.type,
      decoratedSuggestion: decoratedMethodName ?? undefined,
      language: ctx.recCanvasLanguageRef.current,
    });
  }
  if (typeof decorated.index === "number") {
    ctx.actionCacheRef.current.set(decorated.index, decorated);
  }
  window.dispatchEvent(
    new CustomEvent("recorder:action", { detail: decorated }),
  );
};

const handleActionsResync: Handler = (ctx, msg) => {
  // T003 splice-in-middle: server rebuilt session.actions and
  // sent the full payload. Reset the feed and re-emit each
  // action with its new index so every panel stays in lockstep.
  const incoming = Array.isArray(msg.actions)
    ? (msg.actions as RecordedActionMsg[])
    : [];
  ctx.actionCacheRef.current.clear();
  window.dispatchEvent(
    new CustomEvent("recorder:action", { detail: "reset" }),
  );
  for (const a of incoming) {
    const decorated: RecordedActionMsg = { ...a };
    if (typeof decorated.index === "number") {
      ctx.actionCacheRef.current.set(decorated.index, decorated);
    }
    window.dispatchEvent(
      new CustomEvent("recorder:action", { detail: decorated }),
    );
  }
};

const handleActionNamed: Handler = (ctx, msg) => {
  if (typeof msg.index === "number") {
    const cached = ctx.actionCacheRef.current.get(msg.index);
    const decoratedFromMsg =
      typeof msg.decoratedMethodName === "string"
        ? msg.decoratedMethodName
        : null;
    if (cached) {
      ctx.actionCacheRef.current.set(msg.index, {
        ...cached,
        methodName: msg.methodName as string,
        ...(decoratedFromMsg !== null
          ? { decoratedMethodName: decoratedFromMsg }
          : {}),
      });
    }
    // A rename (the action already had a custom name) gets a
    // brief "Undo" affordance — both a toast button and the
    // Cmd/Ctrl+Z keyboard shortcut. Initial naming sends
    // previousMethodName: null and is intentionally not undoable
    // (the user hasn't lost any prior choice yet).
    const prev =
      typeof msg.previousMethodName === "string"
        ? msg.previousMethodName
        : null;
    const idx = msg.index;
    if (prev !== null && prev !== msg.methodName) {
      // Replace any in-flight rename undo for this same index so
      // a stack of consecutive renames only ever exposes the
      // most recent one (matching the server's one-shot model).
      ctx.undoStackRef.current = ctx.undoStackRef.current.filter(
        (e) => !(e.kind === "rename" && e.index === idx),
      );
      ctx.undoStackRef.current.push({ kind: "rename", index: idx });
      const sendUndoRename = () => {
        if (
          ctx.wsRef.current &&
          ctx.wsRef.current.readyState === WebSocket.OPEN
        ) {
          ctx.wsRef.current.send(
            JSON.stringify({ type: "undo-name-action", index: idx }),
          );
        }
      };
      toast(`Renamed to ${msg.methodName}`, {
        id: `undo-rename-${idx}`,
        duration: 6000,
        action: { label: "Undo", onClick: sendUndoRename },
      });
    }
  }
  window.dispatchEvent(
    new CustomEvent("recorder:action-named", {
      detail: {
        index: msg.index,
        methodName: msg.methodName,
        decoratedMethodName:
          typeof msg.decoratedMethodName === "string"
            ? msg.decoratedMethodName
            : null,
      },
    }),
  );
  // Server accepted the name — close the current prompt (if it was
  // for this index) and show the next queued one.
  ctx.setNamePrompt((curr) => {
    if (curr && curr.index === msg.index) {
      const next = ctx.nameQueueRef.current.shift();
      if (next) {
        ctx.setNameValue(next.suggested);
        return next;
      }
      return null;
    }
    return curr;
  });
};

const handleActionDeleted: Handler = (ctx, msg) => {
  window.dispatchEvent(
    new CustomEvent("recorder:action-deleted", {
      detail: { index: msg.index },
    }),
  );
  if (typeof msg.index === "number") {
    const idx = msg.index;
    // Track this index so Cmd/Ctrl+Z restores the most-recent
    // delete first (LIFO).
    ctx.undoStackRef.current.push({ kind: "delete", index: idx });
    // The row is gone — drop any pending rename undo for it
    // and dismiss the matching toast so a stale "Undo" can't
    // race against the upcoming delete-undo flow.
    ctx.undoStackRef.current = ctx.undoStackRef.current.filter(
      (e) => !(e.kind === "rename" && e.index === idx),
    );
    toast.dismiss(`undo-rename-${idx}`);
    // Suppress the per-row toast when this index is part of an
    // in-flight bulk delete — the bulk toast (shown by the
    // request-delete-bulk handler) covers the whole batch.
    if (ctx.bulkDeletingRef.current.has(idx)) {
      ctx.bulkDeletingRef.current.delete(idx);
    } else {
      const sendUndelete = () => {
        if (
          ctx.wsRef.current &&
          ctx.wsRef.current.readyState === WebSocket.OPEN
        ) {
          ctx.wsRef.current.send(
            JSON.stringify({ type: "undelete-action", index: idx }),
          );
        }
      };
      // Brief in-app affordance — Sonner's action button drives the
      // undo. The toast id lets us dismiss it once the server
      // confirms the restore (or it expires on its own).
      toast("Action deleted", {
        id: `undo-action-${idx}`,
        duration: 6000,
        action: { label: "Undo", onClick: sendUndelete },
      });
    }
    // Note: we deliberately do NOT pop from undoStackRef when the
    // toast auto-closes. The Cmd/Ctrl+Z shortcut keeps working for
    // the rest of the session — the toast is just the most visible
    // affordance, not the only one.
  }
  // If a name prompt was open or queued for the deleted action,
  // drop it: there's no longer anything to name. Drain to the next
  // queued prompt so the user is never stuck on a stale dialog.
  ctx.nameQueueRef.current = ctx.nameQueueRef.current.filter(
    (q) => q.index !== msg.index,
  );
  ctx.setNamePrompt((curr) => {
    if (curr && curr.index === msg.index) {
      const next = ctx.nameQueueRef.current.shift();
      if (next) {
        ctx.setNameValue(next.suggested);
        return next;
      }
      return null;
    }
    return curr;
  });
};

const handleActionUndeleted: Handler = (ctx, msg) => {
  if (typeof msg.index === "number") {
    const action = (msg.action ?? {}) as RecordedActionMsg;
    const decorated: RecordedActionMsg = {
      ...action,
      index: msg.index,
      suggestedMethodName:
        typeof msg.suggestedMethodName === "string"
          ? msg.suggestedMethodName
          : (action.suggestedMethodName ?? null),
      suggestedNoun:
        typeof msg.suggestedNoun === "string"
          ? msg.suggestedNoun
          : (action.suggestedNoun ?? null),
      decoratedMethodName:
        typeof msg.decoratedMethodName === "string"
          ? msg.decoratedMethodName
          : (action.decoratedMethodName ?? null),
    };
    ctx.actionCacheRef.current.set(msg.index, decorated);
    // Drop the delete entry from the undo stack so a follow-up
    // Cmd/Ctrl+Z moves on to the next previously-deleted action.
    // Rename entries for the same index were already cleared
    // when the action was deleted, so nothing to do for those.
    ctx.undoStackRef.current = ctx.undoStackRef.current.filter(
      (e) => !(e.kind === "delete" && e.index === msg.index),
    );
    // Dismiss the toast for this index so the stale "Undo" button
    // can't be clicked a second time.
    toast.dismiss(`undo-action-${msg.index}`);
    // If this index was part of a still-active bulk batch, drop
    // it from that batch so a later Undo click on the bulk toast
    // doesn't re-restore something the user already manually
    // recovered. If the batch becomes empty, dismiss its toast.
    for (const [tid, idxs] of ctx.bulkToastsRef.current) {
      const i = idxs.indexOf(msg.index);
      if (i !== -1) {
        idxs.splice(i, 1);
        if (idxs.length === 0) {
          ctx.bulkToastsRef.current.delete(tid);
          toast.dismiss(tid);
        }
      }
    }
    window.dispatchEvent(
      new CustomEvent("recorder:action-undeleted", {
        detail: { item: decorated },
      }),
    );
  }
};

const handleActionNameUndone: Handler = (ctx, msg) => {
  // Server confirmed a rename undo. The restored methodName is
  // either the previous custom name (string) or null (no custom
  // name — the auto-generated suggestion takes over again). For
  // C# the server also re-broadcasts `decoratedMethodName` so
  // the feed display stays in sync with the new name.
  if (typeof msg.index === "number") {
    const idx = msg.index;
    const restored: string | null =
      typeof msg.methodName === "string" ? msg.methodName : null;
    const decoratedFromMsg: string | null =
      typeof msg.decoratedMethodName === "string"
        ? msg.decoratedMethodName
        : null;
    const cached = ctx.actionCacheRef.current.get(idx);
    if (cached) {
      const next = { ...cached };
      if (restored === null) {
        delete next.methodName;
      } else {
        next.methodName = restored;
      }
      if (decoratedFromMsg !== null) {
        next.decoratedMethodName = decoratedFromMsg;
      } else {
        delete next.decoratedMethodName;
      }
      ctx.actionCacheRef.current.set(idx, next);
    }
    // Drop the matching rename entry (the server consumed the
    // one-shot undo) and dismiss the toast so the same Undo
    // button can't fire twice.
    ctx.undoStackRef.current = ctx.undoStackRef.current.filter(
      (e) => !(e.kind === "rename" && e.index === idx),
    );
    toast.dismiss(`undo-rename-${idx}`);
    window.dispatchEvent(
      new CustomEvent("recorder:action-name-undone", {
        detail: {
          index: idx,
          methodName: restored,
          decoratedMethodName: decoratedFromMsg,
        },
      }),
    );
  }
};

const handleUndoNameActionError: Handler = (_ctx, msg) => {
  toast.error(`Could not undo rename: ${msg.message ?? "unknown error"}`);
};

const handleUndeleteActionError: Handler = (_ctx, msg) => {
  toast.error(`Could not restore action: ${msg.message ?? "unknown error"}`);
};

const handleDeleteActionError: Handler = (_ctx, msg) => {
  toast.error(`Could not delete action: ${msg.message ?? "unknown error"}`);
};

const handleNameActionError: Handler = (ctx, msg) => {
  // The server rejected the chosen name (usually a duplicate). Keep
  // the prompt open and pre-fill with the suggested alternative if
  // one was returned, so the user can accept it with a single Enter.
  toast.error(`Could not name action: ${msg.message ?? "unknown error"}`);
  if (typeof msg.suggestedName === "string") {
    ctx.setNameValue(msg.suggestedName);
  }
};

const handleBodyPreview: Handler = (_ctx, msg) => {
  if (Array.isArray(msg.lines)) {
    const lines = msg.lines as string[];
    const lineActionIndices = Array.isArray(msg.lineActionIndices)
      ? (msg.lineActionIndices as Array<number | null>)
      : new Array(lines.length).fill(null);
    window.dispatchEvent(
      new CustomEvent("recorder:body-preview", {
        detail: { lines, lineActionIndices },
      }),
    );
  }
};

const handleStopped: Handler = (_ctx, msg) => {
  toast.success((msg.summary as string) ?? "Recording stopped");
  if (typeof msg.hookBackupPath === "string" && msg.hookBackupPath) {
    toast.info(
      `Saved the previous hook body to ${msg.hookBackupPath} in case you need to recover it.`,
      { duration: 10000 },
    );
  }
};

const handleFillError: Handler = (_ctx, msg) => {
  toast.error(`Could not fill field: ${msg.message ?? "unknown error"}`);
};

const handleAddAssertionError: Handler = (_ctx, msg) => {
  toast.error(`Could not add assertion: ${msg.message ?? "unknown error"}`);
};

const handleMoveActionError: Handler = (_ctx, msg) => {
  toast.error(`Could not move action: ${msg.message ?? "unknown error"}`);
};

const handleDuplicateActionError: Handler = (_ctx, msg) => {
  toast.error(`Could not duplicate action: ${msg.message ?? "unknown error"}`);
};

const handleEditActionError: Handler = (_ctx, msg) => {
  toast.error(`Could not edit action: ${msg.message ?? "unknown error"}`);
};

const handleFeedReset: Handler = (ctx, msg) => {
  // Reorder/insert/edit operations re-key every visible row, so
  // the server publishes a full snapshot. The actions feed
  // listens for this event and rebuilds its in-memory list.
  const rows = Array.isArray(msg.actions) ? msg.actions : [];
  const items: RecordedActionMsg[] = [];
  let lastUrl: string | null = null;
  for (const r of rows) {
    const obj = r as Record<string, unknown>;
    const action = (obj.action ?? {}) as RecordedActionMsg;
    const idx = typeof obj.index === "number" ? obj.index : undefined;
    const item: RecordedActionMsg = {
      ...action,
      index: idx,
      suggestedMethodName:
        typeof obj.suggestedMethodName === "string"
          ? obj.suggestedMethodName
          : (action.suggestedMethodName ?? null),
      suggestedNoun:
        typeof obj.suggestedNoun === "string"
          ? obj.suggestedNoun
          : (action.suggestedNoun ?? null),
      decoratedMethodName:
        typeof obj.decoratedMethodName === "string"
          ? obj.decoratedMethodName
          : (action.decoratedMethodName ?? null),
    };
    items.push(item);
    if (typeof idx === "number") {
      ctx.actionCacheRef.current.set(idx, item);
    }
    if (typeof action.url === "string" && action.url) {
      lastUrl = action.url;
    }
  }
  // Reopening a stopped session over the WebSocket replays the
  // snapshot via this same `feedReset` envelope. Per-action
  // `{type:"action"}` events would normally seed `liveUrl` for
  // the canvas header, but those don't fire on snapshot replay.
  // Pull the most recent URL out of the snapshot so the header
  // shows where the recording left off instead of going blank.
  if (lastUrl) ctx.setLiveUrl(lastUrl);
  // Reordering invalidates the LIFO undo stack and the in-flight
  // bulk-undo toasts because they reference indices that may now
  // point to different actions. Drop them rather than risk
  // restoring the wrong row.
  ctx.undoStackRef.current = [];
  for (const tid of ctx.bulkToastsRef.current.keys()) {
    toast.dismiss(tid);
  }
  ctx.bulkToastsRef.current.clear();
  window.dispatchEvent(
    new CustomEvent("recorder:feed-reset", { detail: { items } }),
  );
  // If the server hinted a label for a freshly-inserted assertion,
  // queue the same name prompt the original add path would have
  // shown. The pending row is the one whose action lacks a
  // methodName at the inserted position.
  const pending =
    typeof msg.pendingSuggestedMethodName === "string"
      ? msg.pendingSuggestedMethodName
      : null;
  if (pending) {
    const inserted = items.find(
      (it) =>
        !it.methodName &&
        it.suggestedMethodName === pending &&
        typeof it.index === "number",
    );
    if (inserted && typeof inserted.index === "number") {
      ctx.enqueueNamePromptRef.current({
        index: inserted.index,
        suggested: pending,
        actionType: inserted.type,
        language: ctx.recCanvasLanguageRef.current,
      });
    }
  }
};

const handlePickElementResult: Handler = (_ctx, msg) => {
  // Right-click "Assert text on this element" came back with a
  // selector + visible text. Hand it to the RightPanel which
  // owns the AddAssertionDialog state so it can re-open with
  // the fields pre-filled.
  window.dispatchEvent(
    new CustomEvent("recorder:assert-prefill", {
      detail: {
        selector: typeof msg.selector === "string" ? msg.selector : "",
        text: typeof msg.text === "string" ? msg.text : "",
      },
    }),
  );
};

const handlePickElementError: Handler = (_ctx, msg) => {
  toast.error(`Could not pick element: ${msg.message ?? "unknown error"}`);
};

/**
 * Pre-attach browsing: the user clicked a text field in an open-browser
 * session that is not recording yet. Open the fill dialog in
 * value-only mode so they can type (to log in, search, fill a form)
 * without any of it being recorded or named.
 */
const handleEditableFocus: Handler = (ctx, msg) => {
  const editable = msg.editable as
    | { label?: string; kind?: FillPromptState["kind"] }
    | undefined;
  if (typeof msg.selector !== "string" || !msg.selector) return;
  ctx.setFillValue("");
  ctx.setFillNameValue("");
  ctx.setFillPrompt({
    label: editable?.label ?? "",
    kind: editable?.kind ?? "input",
    selector: msg.selector,
    nameless: true,
  });
};

const HANDLERS: Record<string, Handler> = {
  error: handleError,
  frame: handleFrame,
  action: handleAction,
  editableFocus: handleEditableFocus,
  "actions-resync": handleActionsResync,
  actionNamed: handleActionNamed,
  actionDeleted: handleActionDeleted,
  actionUndeleted: handleActionUndeleted,
  actionNameUndone: handleActionNameUndone,
  undoNameActionError: handleUndoNameActionError,
  undeleteActionError: handleUndeleteActionError,
  deleteActionError: handleDeleteActionError,
  nameActionError: handleNameActionError,
  bodyPreview: handleBodyPreview,
  stopped: handleStopped,
  fillError: handleFillError,
  addAssertionError: handleAddAssertionError,
  moveActionError: handleMoveActionError,
  duplicateActionError: handleDuplicateActionError,
  editActionError: handleEditActionError,
  feedReset: handleFeedReset,
  pickElementResult: handlePickElementResult,
  pickElementError: handlePickElementError,
};

/**
 * Build the `onmessage` callback for the recording WebSocket. Each
 * inbound message type has its own small handler above; this just
 * parses JSON and dispatches via the `HANDLERS` table. Unknown
 * types are silently ignored (forward-compatible with future server
 * additions).
 */
export function createWsMessageHandler(
  ctx: MessageHandlerCtx,
): (ev: MessageEvent) => void {
  return (ev: MessageEvent) => {
    try {
      const msg = JSON.parse(ev.data) as Msg;
      const handler = HANDLERS[msg.type];
      if (handler) handler(ctx, msg);
    } catch {
      /* ignore */
    }
  };
}

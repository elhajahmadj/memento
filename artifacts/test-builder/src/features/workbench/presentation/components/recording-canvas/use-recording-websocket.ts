import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  RecordedActionMsg,
  FrameMsg,
} from "@/features/workbench/domain/types";
import type {
  FillPromptState,
  NamePromptItem,
  RecordingLanguage,
  UndoEntry,
} from "./types";
import { createWsMessageHandler } from "./ws-message-handlers";
import { installEventForwarders } from "./ws-event-forwarders";

type Options = {
  recCanvasLanguageRef: MutableRefObject<RecordingLanguage>;
  setFrame: Dispatch<SetStateAction<FrameMsg | null>>;
  setLiveUrl: Dispatch<SetStateAction<string>>;
  setFillPrompt: Dispatch<SetStateAction<FillPromptState | null>>;
  setFillValue: Dispatch<SetStateAction<string>>;
  setFillNameValue: Dispatch<SetStateAction<string>>;
  setNamePrompt: Dispatch<SetStateAction<NamePromptItem | null>>;
  setNameValue: Dispatch<SetStateAction<string>>;
};

/**
 * Owns the recording WebSocket: subscribes to server events
 * (frame/action/named/deleted/etc.), bridges them to the window event
 * bus the other panels listen to, and forwards user actions
 * (rename/delete/move/duplicate/undelete/add-assertion/add-wait/etc.)
 * from those panels back to the server. Returns the `wsRef` so the
 * parent's submit handlers can send name-action / fill messages.
 *
 * Inbound message dispatch lives in `./ws-message-handlers` and the
 * outbound window-event-bus forwarders live in `./ws-event-forwarders`;
 * this file is only the connect / reconnect / cleanup wiring plus the
 * two `useEffect` calls that mount the two halves.
 */
export function useRecordingWebSocket(opts: Options): {
  wsRef: MutableRefObject<WebSocket | null>;
  enqueueNamePrompt: (item: NamePromptItem) => void;
} {
  const {
    recCanvasLanguageRef,
    setFrame,
    setLiveUrl,
    setFillPrompt,
    setFillValue,
    setFillNameValue,
    setNamePrompt,
    setNameValue,
  } = opts;

  const wsRef = useRef<WebSocket | null>(null);
  // Stack of recently-undoable session edits (delete or rename). Cmd/Ctrl+Z
  // pops the most recent and sends the matching undo to the server; the
  // toast's Undo button takes the same path. Entries are removed when the
  // server confirms the undo or when a follow-up edit invalidates them.
  const undoStackRef = useRef<UndoEntry[]>([]);
  // Cache the most recent action payload per index so we can re-insert it
  // into the feed at the original position when the server confirms an
  // undelete.
  const actionCacheRef = useRef<Map<number, RecordedActionMsg>>(new Map());
  // Indices currently being deleted as part of a bulk request. The
  // per-index `actionDeleted` events still drive feed/preview updates,
  // but we suppress their individual undo toasts in favor of one
  // aggregated bulk toast per batch.
  const bulkDeletingRef = useRef<Set<number>>(new Set());
  // Active bulk-undo toasts, keyed by toast id. Cleared when a new
  // action is recorded (Undo would restore stale state) or when the
  // user clicks Undo on a particular batch.
  const bulkToastsRef = useRef<Map<string, number[]>>(new Map());
  // FIFO queue of pending name prompts. Recording continues while the user
  // ignores the popup, so additional non-navigate actions may queue up.
  const nameQueueRef = useRef<NamePromptItem[]>([]);

  const enqueueNamePromptRef = useRef<(item: NamePromptItem) => void>(() => {});
  const enqueueNamePrompt = (item: NamePromptItem) => {
    nameQueueRef.current.push(item);
    // Promote immediately if no prompt is currently visible. We can't read
    // `namePrompt` (stale closure inside the WS handler), so we use the
    // functional setter to inspect the latest state.
    setNamePrompt((curr) => {
      if (curr) return curr;
      const next = nameQueueRef.current.shift();
      if (!next) return null;
      setNameValue(next.suggested);
      return next;
    });
  };
  enqueueNamePromptRef.current = enqueueNamePrompt;

  // Main effect: open the WebSocket and dispatch all incoming server
  // messages. Self-contained — no React state besides the setters
  // passed in via opts.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("recorder:action", { detail: "reset" }),
    );
    window.dispatchEvent(
      new CustomEvent("recorder:body-preview", {
        detail: { lines: [], lineActionIndices: [] },
      }),
    );
    let intentionalClose = false;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // Exponential backoff capped at 10s so a long outage doesn't hammer the
    // server, but a transient blip reconnects in under a second.
    const nextDelayMs = () =>
      Math.min(10_000, 500 * Math.pow(2, Math.max(0, attempts - 1)));

    const scheduleReconnect = () => {
      if (intentionalClose) return;
      if (reconnectTimer !== null) return;
      const delay = nextDelayMs();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (intentionalClose) return;
        connect();
      }, delay);
    };

    const handleMessage = createWsMessageHandler({
      recCanvasLanguageRef,
      setFrame,
      setLiveUrl,
      setFillPrompt,
      setFillValue,
      setFillNameValue,
      setNamePrompt,
      setNameValue,
      wsRef,
      undoStackRef,
      actionCacheRef,
      bulkDeletingRef,
      bulkToastsRef,
      nameQueueRef,
      enqueueNamePromptRef,
      abortReconnect: () => {
        // Server has no live session — stop trying to reattach. The
        // parent's recording-status poll will unmount this canvas
        // shortly.
        intentionalClose = true;
        if (reconnectTimer !== null) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      },
    });

    const connect = () => {
      if (intentionalClose) return;
      attempts += 1;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws/recording`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        window.dispatchEvent(new CustomEvent("recorder:connected"));
      };
      ws.onclose = () => {
        // Skip the dispatch when the cleanup function closed the socket
        // (recording stopped / component unmounted) — the preview pane is
        // about to unmount anyway and we don't want a flash of "Reconnecting…".
        if (intentionalClose) return;
        window.dispatchEvent(new CustomEvent("recorder:disconnected"));
        scheduleReconnect();
      };
      ws.onerror = () => {
        if (intentionalClose) return;
        window.dispatchEvent(new CustomEvent("recorder:disconnected"));
        // Reconnect is scheduled by onclose, which fires after onerror.
      };
      ws.onmessage = handleMessage;
    };

    connect();

    return () => {
      intentionalClose = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Second effect: listen for window events fired by other panels
  // (rename / delete / move / duplicate / undelete / assertion / wait /
  // insert-shared-step) and forward them through the WebSocket. Also
  // wires the Cmd/Ctrl+Z LIFO undo shortcut.
  useEffect(() => {
    return installEventForwarders({
      wsRef,
      undoStackRef,
      bulkDeletingRef,
      bulkToastsRef,
      enqueueNamePromptRef,
      recCanvasLanguageRef,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { wsRef, enqueueNamePrompt };
}

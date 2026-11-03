import { useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, Minimize2, Square } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import type { FrameMsg } from "@/features/workbench/domain/types";

type Props = {
  recording: boolean;
  /**
   * True when the session is actually capturing actions. An
   * open-browser session before attach has `recording` true (frames
   * stream, input is forwarded) but `capturing` false.
   */
  capturing: boolean;
  frame: FrameMsg | null;
  liveUrl: string;
  wsRef: React.MutableRefObject<WebSocket | null>;
};

/**
 * Live-frame viewer: header (recording badge + URL + viewport + pop-out
 * button), the click-capturing browser image with its right-click
 * "Assert text on this element" context menu, the optional fullscreen
 * pop-out overlay, and the fallback keystroke input at the bottom.
 *
 * Owns its own pop-out + pick-coordinate state because no consumer
 * outside this view cares about either. WebSocket access is passed in
 * via a ref so click/keystroke events can dispatch directly.
 */
export function CanvasView({ recording, capturing, frame, liveUrl, wsRef }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const [popped, setPopped] = useState(false);

  // Esc closes the pop-out overlay so it never traps the user.
  useEffect(() => {
    if (!popped) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopped(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popped]);

  const sendClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!frame || !wsRef.current) return;
    // Use the click target's rect so this works whether the image is
    // rendered inline in the panel or in the fullscreen pop-out overlay.
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * frame.width;
    const y = ((e.clientY - rect.top) / rect.height) * frame.height;
    wsRef.current.send(
      JSON.stringify({ type: "click", x: Math.round(x), y: Math.round(y) }),
    );
    // Move focus to the keystroke input so the user can immediately type.
    keyInputRef.current?.focus();
  };

  // Coordinates of the most recent right-click on the live canvas.
  // Saved in a ref so the context-menu "Assert text on this element"
  // item can resolve the click point at the moment the user picks it
  // (Radix's ContextMenuItem doesn't carry the original event coords).
  const pickCoordsRef = useRef<{ x: number; y: number } | null>(null);
  const handleContextMenu = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!frame) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * frame.width;
    const y = ((e.clientY - rect.top) / rect.height) * frame.height;
    pickCoordsRef.current = { x: Math.round(x), y: Math.round(y) };
  };
  const sendPickAtLastCoords = () => {
    const coords = pickCoordsRef.current;
    if (!coords || !wsRef.current) return;
    wsRef.current.send(
      JSON.stringify({ type: "pick-element", x: coords.x, y: coords.y }),
    );
  };

  const sendKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!wsRef.current) return;
    e.preventDefault();
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      wsRef.current.send(JSON.stringify({ type: "type", text: e.key }));
    } else {
      wsRef.current.send(JSON.stringify({ type: "key", key: e.key }));
    }
  };

  return (
    <>
      <div className="h-9 px-3 border-b border-border flex items-center gap-3 text-xs font-mono">
        {recording && !capturing ? (
          // Open-browser session that has not been attached yet. The
          // server marks these `phase: "recording"` so the frame stream
          // and input forwarding work, but nothing is being captured —
          // saying RECORDING here was simply untrue.
          <span
            className="inline-flex items-center gap-1.5 text-muted-foreground"
            data-testid="text-recording-browsing"
          >
            <Square className="h-3 w-3" />
            BROWSING — nothing is being recorded yet. Click Start Recording
            to capture.
          </span>
        ) : recording ? (
          <span className="inline-flex items-center gap-1.5 text-destructive">
            <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
            RECORDING
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 text-muted-foreground"
            data-testid="text-recording-stopped"
          >
            <Square className="h-3 w-3 fill-current" />
            STOPPED — review steps, add assertions, then save or request approval
          </span>
        )}
        <span className="text-muted-foreground truncate flex-1">{liveUrl}</span>
        {recording && frame && (
          <span
            className="text-muted-foreground"
            data-testid="text-recording-viewport"
          >
            {frame.width}×{frame.height}
          </span>
        )}
        {recording && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setPopped(true)}
            disabled={!frame || popped}
            data-testid="button-popout-recording"
            title="Pop out (fullscreen)"
            aria-label="Pop out recording browser to fullscreen"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center bg-black/40 overflow-hidden p-3">
        {!recording ? (
          <div
            className="text-muted-foreground text-sm text-center max-w-sm"
            data-testid="text-recording-stopped-help"
          >
            <Square className="h-5 w-5 mx-auto mb-2" />
            This recording is stopped. Review the captured steps in the
            actions panel, use <strong>Add assertion</strong> to verify page
            state, then click <strong>Save</strong> or{" "}
            <strong>Request SDET approval</strong> to finalize — or{" "}
            <strong>Discard</strong> to throw it away.
          </div>
        ) : frame ? (
          !popped && (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <img
                  ref={imgRef}
                  src={`data:image/jpeg;base64,${frame.data}`}
                  alt="browser frame"
                  onClick={sendClick}
                  onContextMenu={handleContextMenu}
                  className="max-h-full max-w-full object-contain border border-border cursor-crosshair"
                  data-testid="recording-canvas"
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={sendPickAtLastCoords}
                  data-testid="menuitem-assert-text-here"
                >
                  Assert text on this element
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        ) : (
          <div className="text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Waiting for first frame…
          </div>
        )}
      </div>
      {popped && frame && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="recording-popout-title"
          className="fixed inset-0 z-50 bg-black/90 flex flex-col"
          data-testid="recording-popout-overlay"
        >
          <div className="h-10 px-3 border-b border-border flex items-center gap-3 text-xs font-mono bg-card">
            <span
              id="recording-popout-title"
              className="inline-flex items-center gap-1.5 text-destructive"
            >
              <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
              RECORDING
            </span>
            <span className="text-muted-foreground truncate flex-1">
              {liveUrl}
            </span>
            <span className="text-muted-foreground">
              {frame.width}×{frame.height}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => setPopped(false)}
              data-testid="button-close-popout-recording"
              title="Exit fullscreen (Esc)"
              aria-label="Exit fullscreen recording view"
              autoFocus
            >
              <Minimize2 className="h-3.5 w-3.5 mr-1" />
              Exit
            </Button>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden p-4">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <img
                  src={`data:image/jpeg;base64,${frame.data}`}
                  alt="browser frame"
                  onClick={sendClick}
                  onContextMenu={handleContextMenu}
                  className="max-h-full max-w-full object-contain border border-border cursor-crosshair"
                  data-testid="recording-canvas-popout"
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={sendPickAtLastCoords}
                  data-testid="menuitem-assert-text-here-popout"
                >
                  Assert text on this element
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </div>
      )}
      {recording && (
        <div className="border-t border-border p-2 bg-card">
          <Input
            ref={keyInputRef}
            placeholder="Fallback: send raw keystrokes (e.g. Tab, Enter). Text inputs prompt automatically."
            onKeyDown={sendKey}
            className="font-mono text-xs"
            data-testid="input-recording-keys"
          />
        </div>
      )}
    </>
  );
}

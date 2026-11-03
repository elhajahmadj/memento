import {
  useState,
  useEffect,
  useRef,
} from "react";
import { toast } from "sonner";
import {
  Prism as SyntaxHighlighter,
  createElement as createHighlighterElement,
} from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Copy,
  Loader2,
  Code2,
} from "lucide-react";


// Live preview of the test-method body that will be written to disk
  // when the user stops the recording. The body is rendered in whatever
  // language the project targets (C# / Python / Node.js / Java) — the
  // server picks the right codegen path based on `project.language`.
  // Subscribes to "recorder:body-preview"
  // events emitted from the recording WebSocket; the server recomputes the
  // preview after every action push and after every name acceptance, so the
  // preview reflects custom names, dedup suffixes, and value arguments
  // exactly as `generateSuiteFiles` will emit them at stop time.
  //
  // Each preview line is paired with the session-array index of the
  // recorded action that produced it (or `null` for setup lines). Hovering
  // a line broadcasts a `recorder:hover-action` event so the action feed
  // can highlight the matching row, and vice versa — keeping feed and
  // preview visually linked even after renames, deletions, and live
  // bodyPreview updates (the server rebuilds the mapping each broadcast).
export function TestBodyPreview() {
    const [lines, setLines] = useState<string[]>([]);
    const [lineActionIndices, setLineActionIndices] = useState<
      Array<number | null>
    >([]);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const [disconnected, setDisconnected] = useState(false);
    const codeContainerRef = useRef<HTMLDivElement>(null);
    // After a focus event arrives, defer the scroll until SyntaxHighlighter
    // has rendered the new (or possibly unchanged) code so the line element
    // exists in the DOM before we try to scroll it into view.
    const pendingScrollIndexRef = useRef<number | null>(null);
    useEffect(() => {
      const handler = (ev: Event) => {
        const e = ev as CustomEvent<{
          lines: string[];
          lineActionIndices: Array<number | null>;
        }>;
        const detail = e.detail;
        const nextLines = Array.isArray(detail?.lines) ? detail.lines : [];
        const nextIndices = Array.isArray(detail?.lineActionIndices)
          ? detail.lineActionIndices
          : new Array(nextLines.length).fill(null);
        setLines(nextLines);
        setLineActionIndices(nextIndices);
        // A fresh broadcast means the socket is alive again — clear any
        // "Reconnecting…" hint that was put up while the WS was down.
        setDisconnected(false);
      };
      const hoverHandler = (ev: Event) => {
        const e = ev as CustomEvent<{ index: number | null }>;
        setHoveredIndex(
          typeof e.detail?.index === "number" ? e.detail.index : null,
        );
      };
      const focusHandler = (ev: Event) => {
        const e = ev as CustomEvent<{ index: number | null }>;
        const idx = typeof e.detail?.index === "number" ? e.detail.index : null;
        setFocusedIndex(idx);
        if (idx === null) return;
        // Defer the actual scroll to the next paint so SyntaxHighlighter has
        // had a chance to render any pending updates (and so that this
        // listener is robust to focus events firing before the DOM is ready).
        pendingScrollIndexRef.current = idx;
      };
      const keyHandler = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        window.dispatchEvent(
          new CustomEvent("recorder:focus-action", {
            detail: { index: null },
          }),
        );
      };
      const disconnectedHandler = () => setDisconnected(true);
      const connectedHandler = () => setDisconnected(false);
      window.addEventListener(
        "recorder:body-preview",
        handler as EventListener,
      );
      window.addEventListener(
        "recorder:hover-action",
        hoverHandler as EventListener,
      );
      window.addEventListener(
        "recorder:focus-action",
        focusHandler as EventListener,
      );
      window.addEventListener("keydown", keyHandler);
      window.addEventListener(
        "recorder:disconnected",
        disconnectedHandler as EventListener,
      );
      window.addEventListener(
        "recorder:connected",
        connectedHandler as EventListener,
      );
      return () => {
        window.removeEventListener(
          "recorder:body-preview",
          handler as EventListener,
        );
        window.removeEventListener(
          "recorder:hover-action",
          hoverHandler as EventListener,
        );
        window.removeEventListener(
          "recorder:focus-action",
          focusHandler as EventListener,
        );
        window.removeEventListener("keydown", keyHandler);
        window.removeEventListener(
          "recorder:disconnected",
          disconnectedHandler as EventListener,
        );
        window.removeEventListener(
          "recorder:connected",
          connectedHandler as EventListener,
        );
      };
    }, []);
    // After every render, if a focus request is pending, locate the matching
    // preview line by its data-testid and scroll it into view. Re-runs when
    // lines change so a focus arriving just before a body-preview update
    // still scrolls correctly once the new lines are rendered.
    useEffect(() => {
      const idx = pendingScrollIndexRef.current;
      if (idx === null) return;
      const root = codeContainerRef.current;
      if (!root) return;
      const el = root.querySelector(
        `[data-testid="preview-line-action-${idx}"]`,
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        pendingScrollIndexRef.current = null;
      }
    }, [lines, lineActionIndices, focusedIndex]);
    // If the currently-focused action disappears from the preview (e.g. it
    // was deleted), clear the focus state so we don't render a stale outline.
    useEffect(() => {
      if (
        focusedIndex !== null &&
        !lineActionIndices.some((i) => i === focusedIndex)
      ) {
        setFocusedIndex(null);
      }
    }, [lineActionIndices, focusedIndex]);
    const code = lines.join("\n");
    const clearFocus = () => {
      setFocusedIndex(null);
      window.dispatchEvent(
        new CustomEvent("recorder:focus-action", {
          detail: { index: null },
        }),
      );
    };
    return (
      <div
        className="border-t border-sidebar-border flex flex-col min-h-0"
        data-testid="panel-test-body-preview"
        onClick={clearFocus}
      >
        <div className="h-9 flex items-center px-3 border-b border-sidebar-border text-xs font-mono uppercase tracking-wider text-muted-foreground shrink-0">
          <Code2 className="h-3.5 w-3.5 mr-2" />
          Test Body Preview
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 ml-auto"
            onClick={() => {
              navigator.clipboard.writeText(code);
              toast.success("Copied to clipboard");
            }}
            disabled={lines.length === 0}
            data-testid="button-copy-test-body-preview"
            title="Copy"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          {disconnected ? (
            <div
              className="text-xs text-destructive px-3 py-3 flex items-center gap-2"
              data-testid="text-test-body-preview-disconnected"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Reconnecting to the recorder…
            </div>
          ) : lines.length === 0 ? (
            <div
              className="text-xs text-muted-foreground px-3 py-3"
              data-testid="text-test-body-preview-empty"
            >
              The generated test method body will appear here as you record.
            </div>
          ) : (
            <div ref={codeContainerRef}>
              <SyntaxHighlighter
                language="csharp"
                style={vscDarkPlus}
                customStyle={{
                  margin: 0,
                  background: "transparent",
                  fontSize: "12px",
                  padding: "10px 12px",
                }}
                data-testid="code-test-body-preview"
                wrapLines
                renderer={({ rows, stylesheet, useInlineStyles }) =>
                  rows.map((node, i) => {
                    const idx = lineActionIndices[i] ?? null;
                    const isHovered =
                      idx !== null &&
                      hoveredIndex !== null &&
                      idx === hoveredIndex;
                    const isFocused =
                      idx !== null &&
                      focusedIndex !== null &&
                      idx === focusedIndex;
                    const background = isHovered
                      ? "rgba(99, 102, 241, 0.22)"
                      : isFocused
                        ? "rgba(99, 102, 241, 0.14)"
                        : "transparent";
                    return (
                      <span
                        key={`line-${i}`}
                        data-testid={
                          idx !== null
                            ? `preview-line-action-${idx}`
                            : `preview-line-setup-${i}`
                        }
                        style={{
                          display: "block",
                          background,
                          borderLeft: isFocused
                            ? "2px solid rgb(129, 140, 248)"
                            : "2px solid transparent",
                          cursor: idx !== null ? "pointer" : "default",
                          transition: "background 80ms ease-out",
                        }}
                        onMouseEnter={
                          idx !== null
                            ? () =>
                                window.dispatchEvent(
                                  new CustomEvent("recorder:hover-action", {
                                    detail: { index: idx },
                                  }),
                                )
                            : undefined
                        }
                        onMouseLeave={
                          idx !== null
                            ? () =>
                                window.dispatchEvent(
                                  new CustomEvent("recorder:hover-action", {
                                    detail: { index: null },
                                  }),
                                )
                            : undefined
                        }
                        onClick={
                          idx !== null
                            ? (e) => {
                                e.stopPropagation();
                                setFocusedIndex(idx);
                                window.dispatchEvent(
                                  new CustomEvent("recorder:focus-action", {
                                    detail: { index: idx },
                                  }),
                                );
                              }
                            : undefined
                        }
                      >
                        {createHighlighterElement({
                          node,
                          stylesheet,
                          useInlineStyles,
                          key: `line-content-${i}`,
                        })}
                      </span>
                    );
                  })
                }
              >
                {code}
              </SyntaxHighlighter>
            </div>
          )}
        </ScrollArea>
      </div>
    );
  }

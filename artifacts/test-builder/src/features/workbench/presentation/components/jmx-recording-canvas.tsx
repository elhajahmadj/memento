import { useEffect, useRef, useState } from "react";
import type { FrameMsg } from "@/features/workbench/domain/types";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { CanvasView } from "./recording-canvas/canvas-view";

interface CapturedRow {
  method: string;
  url: string;
  statusCode: number;
  timestamp: number;
  bffClass?: "bff" | "idp" | "upstream";
}

/**
 * Live canvas for an active JMX recording session.
 *
 * The DOM recorder's {@link RecordingCanvas} reuses {@link CanvasView}
 * but also owns the fill-prompt / name-prompt dialog plumbing tied to
 * the action queue. JMX has no action queue (it captures raw HTTP via
 * CDP at the server), so this component is much thinner: open a WS to
 * `/ws/jmx-recording?sessionId=...`, feed frames into `CanvasView`,
 * and forward clicks/keys/scrolls back.
 *
 * The Stop button lives in the workbench toolbar via
 * {@link JmxRecordingControls} (same place as the Start button) — we
 * deliberately don't render a second Stop here to avoid two buttons
 * with the same action on screen.
 *
 * `isCapturing` drives the top banner so the user can see the
 * difference between **preview** (browser open, nothing captured yet —
 * the auto-open-on-create state) and **capturing** (CDP `Network.*`
 * listeners armed, traffic being persisted). Without this the banner
 * always read "JMX RECORDING" with a pulsing red dot, which is what
 * made the auto-opened preview look like an in-flight recording.
 */
export function JmxRecordingCanvas({
  sessionId,
  isCapturing,
  capturedVisible = true,
}: {
  sessionId: string;
  isCapturing: boolean;
  /**
   * Controls whether the right-rail Captured (HTTP requests) panel is
   * rendered. Defaults to `true` to preserve the original layout.
   * When `false`, the live browser fills the freed horizontal space.
   */
  capturedVisible?: boolean;
}) {
  const [frame, setFrame] = useState<FrameMsg | null>(null);
  const [liveUrl, setLiveUrl] = useState<string>("");
  const [captured, setCaptured] = useState<CapturedRow[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws/jmx-recording?sessionId=${encodeURIComponent(sessionId)}`,
    );
    wsRef.current = ws;
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(typeof evt.data === "string" ? evt.data : "");
        if (msg && msg.type === "frame") {
          setFrame({ data: msg.data, width: msg.width, height: msg.height });
          if (typeof msg.url === "string") setLiveUrl(msg.url);
        } else if (msg && msg.type === "captured") {
          setCaptured((prev) =>
            // Cap at 200 rows so a runaway recording doesn't blow up
            // the DOM. Oldest rows fall off the top.
            [
              ...prev.slice(-199),
              {
                method: String(msg.method ?? ""),
                url: String(msg.url ?? ""),
                statusCode: Number(msg.statusCode ?? 0),
                timestamp: Number(msg.timestamp ?? Date.now()),
                ...(msg.bffClass === "bff" ||
                msg.bffClass === "idp" ||
                msg.bffClass === "upstream"
                  ? { bffClass: msg.bffClass }
                  : {}),
              },
            ],
          );
        }
      } catch {
        // ignore malformed frames
      }
    };
    return () => {
      wsRef.current = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, [sessionId]);

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="h-10 px-3 border-b border-border flex items-center gap-3 bg-card">
        {isCapturing ? (
          <>
            <span
              className="inline-flex items-center gap-1.5 text-destructive text-xs font-mono"
              data-testid="jmx-canvas-status-recording"
            >
              <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
              JMX RECORDING
            </span>
            <span className="text-muted-foreground text-xs truncate flex-1">
              Click in the browser below to navigate. HTTP requests are being
              captured and will be saved as a .jmx file when you click Stop in
              the toolbar.
            </span>
          </>
        ) : (
          <>
            <span
              className="inline-flex items-center gap-1.5 text-muted-foreground text-xs font-mono"
              data-testid="jmx-canvas-status-preview"
            >
              <span className="h-2 w-2 rounded-full bg-muted-foreground/60" />
              JMX PREVIEW
            </span>
            <span className="text-muted-foreground text-xs truncate flex-1">
              Browser is open but nothing is being recorded yet. Drive the page
              to your starting state, then click Start Recording in the toolbar
              to begin capturing HTTP traffic.
            </span>
          </>
        )}
      </div>
      {/*
        Pass `recording={true}` unconditionally: in `CanvasView`,
        `recording=false` switches to a "stopped" placeholder that
        hides the live frame. The JMX preview phase still needs the
        live browser visible and interactive (so the user can drive
        the page before clicking Start Recording) — phase is shown
        via the banner above instead.
      */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0">
          {/* `capturing` mirrors the banner above: during the preview
              phase the inner header must not claim RECORDING either. */}
          <CanvasView
            recording={true}
            capturing={isCapturing}
            frame={frame}
            liveUrl={liveUrl}
            wsRef={wsRef}
          />
        </div>
        {capturedVisible && <CapturedRowsPanel rows={captured} />}
      </div>
    </div>
  );
}

type BffFilter = "all" | "bff" | "idp" | "upstream";

const BFF_FILTER_VALUES: readonly BffFilter[] = [
  "all",
  "bff",
  "idp",
  "upstream",
];

function bffFilterStorageKey(userId: string): string {
  return `jmx-recorder.bff-filter.${userId}`;
}

function readPersistedBffFilter(userId: string | null): BffFilter {
  if (!userId || typeof window === "undefined") return "all";
  try {
    const raw = window.localStorage.getItem(bffFilterStorageKey(userId));
    if (raw && (BFF_FILTER_VALUES as readonly string[]).includes(raw)) {
      return raw as BffFilter;
    }
  } catch {
    // localStorage can throw (private mode, quota); fall through to default
  }
  return "all";
}

/**
 * Right-rail list of captured HTTP requests for the active JMX
 * session. Renders a small coloured tag per row when the server has
 * classified the request (BFF projects only); for non-BFF projects
 * `bffClass` is always absent and the tag isn't rendered, so the panel
 * is visually unchanged from the pre-classification version.
 *
 * When any row in the stream carries a `bffClass` (i.e. this is a BFF
 * project), a small counts strip appears above the list showing how
 * traffic splits across BFF / IdP / Upstream. Clicking a count filters
 * the panel to that class; clicking the active one (or the total)
 * clears the filter.
 */
function CapturedRowsPanel({ rows }: { rows: CapturedRow[] }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Seed from localStorage so the user's last-used filter is restored
  // immediately on mount — no flash of unfiltered rows.
  const [filter, setFilter] = useState<BffFilter>(() =>
    readPersistedBffFilter(userId),
  );
  // If the auth user changes (e.g. login/logout in the same tab), pull
  // that user's persisted filter instead of bleeding the previous
  // user's choice across accounts.
  useEffect(() => {
    setFilter(readPersistedBffFilter(userId));
  }, [userId]);
  // Persist on every change (including clearing back to "all") so the
  // next recording / page refresh remembers it. Skipped for anonymous
  // sessions to avoid writing junk we can't scope.
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(bffFilterStorageKey(userId), filter);
    } catch {
      // ignore quota / private-mode failures
    }
  }, [userId, filter]);
  const isBffProject = rows.some((r) => r.bffClass);
  const counts = {
    bff: rows.filter((r) => r.bffClass === "bff").length,
    idp: rows.filter((r) => r.bffClass === "idp").length,
    upstream: rows.filter((r) => r.bffClass === "upstream").length,
  };
  const visible =
    filter === "all" ? rows : rows.filter((r) => r.bffClass === filter);
  const toggle = (next: BffFilter) =>
    setFilter((cur) => (cur === next ? "all" : next));

  return (
    <div
      className="w-80 shrink-0 border-l border-border bg-card flex flex-col"
      data-testid="jmx-captured-rows-panel"
    >
      <div className="h-8 px-3 border-b border-border flex items-center text-xs font-mono text-muted-foreground">
        Captured ({visible.length}
        {filter !== "all" ? ` / ${rows.length}` : ""})
      </div>
      {isBffProject && (
        <div
          className="px-3 py-1.5 border-b border-border flex items-center gap-1.5 text-[11px] font-mono"
          data-testid="jmx-captured-bff-counts"
        >
          <CountChip
            label="BFF"
            count={counts.bff}
            active={filter === "bff"}
            onClick={() => toggle("bff")}
            colorClass="border-emerald-500 text-emerald-600"
            activeClass="bg-emerald-500/10"
            testId="jmx-captured-bff-count-bff"
          />
          <span className="text-muted-foreground">·</span>
          <CountChip
            label="IdP"
            count={counts.idp}
            active={filter === "idp"}
            onClick={() => toggle("idp")}
            colorClass="border-amber-500 text-amber-600"
            activeClass="bg-amber-500/10"
            testId="jmx-captured-bff-count-idp"
          />
          <span className="text-muted-foreground">·</span>
          <CountChip
            label="Upstream"
            count={counts.upstream}
            active={filter === "upstream"}
            onClick={() => toggle("upstream")}
            colorClass="border-sky-500 text-sky-600"
            activeClass="bg-sky-500/10"
            testId="jmx-captured-bff-count-upstream"
          />
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {visible.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">
            {rows.length === 0
              ? "No requests captured yet."
              : "No requests match this filter."}
          </div>
        ) : (
          <ul className="text-xs font-mono">
            {visible.map((r, i) => (
              <li
                key={i}
                className="px-3 py-1.5 border-b border-border/50 flex items-center gap-2"
                data-testid={`jmx-captured-row-${i}`}
                title={r.url}
              >
                {r.bffClass && (
                  <span
                    data-testid={`jmx-captured-bff-class-${i}`}
                    className={`px-1.5 py-0 rounded border text-[10px] uppercase ${
                      r.bffClass === "bff"
                        ? "border-emerald-500 text-emerald-600"
                        : r.bffClass === "idp"
                          ? "border-amber-500 text-amber-600"
                          : "border-sky-500 text-sky-600"
                    }`}
                  >
                    {r.bffClass === "bff"
                      ? "BFF"
                      : r.bffClass === "idp"
                        ? "IdP"
                        : "Upstream"}
                  </span>
                )}
                <span className="text-foreground/80">{r.method}</span>
                <span className="truncate text-muted-foreground">{r.url}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CountChip({
  label,
  count,
  active,
  onClick,
  colorClass,
  activeClass,
  testId,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  colorClass: string;
  activeClass: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      className={`px-1.5 py-0.5 rounded border uppercase tracking-wide transition-colors ${colorClass} ${
        active ? activeClass : "hover:bg-muted/40"
      }`}
    >
      {label} {count}
    </button>
  );
}

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Loader2, MousePointerClick, RotateCw, X } from "lucide-react";
import {
  applyHeal,
  cancelRepickSession,
  fetchHealPreview,
  repickPick,
  startRepickSession,
  summarizeApply,
} from "./heal-api";
import { HealPreviewPanel } from "./preview-panel";
import type {
  FixSelectorContext,
  HealResult,
  RepickStartResult,
} from "./types";

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "live"; session: RepickStartResult; picking: boolean }
  | { kind: "picked"; session: RepickStartResult; selector: string; strategy: string; text: string | null }
  | { kind: "previewing"; session: RepickStartResult; selector: string; preview: HealResult }
  | { kind: "error"; message: string };

/**
 * "Re-pick element" path — launches a server-side Chromium session,
 * streams a screenshot of the failing page, and translates clicks on
 * the screenshot into viewport coordinates the server uses to generate
 * a fresh selector (via the same recorder injection used for initial
 * recording). The selector flows through the standard preview + apply
 * pipeline with `via="repick"` so it's audited correctly.
 */
export function RepickTab({
  context,
  onSwitchTab,
  onApplied,
}: {
  context: FixSelectorContext;
  onSwitchTab: (tab: "ai" | "advanced") => void;
  onApplied: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Make sure we close the server-side Chromium session when the user
  // closes the tab / dialog without finishing the pick.
  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current;
      if (sid) cancelRepickSession(sid);
    };
  }, []);

  const start = async () => {
    if (!context.pageUrl) {
      setPhase({
        kind: "error",
        message:
          "Re-pick needs a page URL captured at failure. Re-run the test, or use the Advanced tab.",
      });
      return;
    }
    setPhase({ kind: "starting" });
    try {
      const session = await startRepickSession(context.pageUrl, context.selector);
      sessionIdRef.current = session.sessionId;
      setPhase({ kind: "live", session, picking: false });
    } catch (err) {
      setPhase({
        kind: "error",
        message: `Couldn't launch the re-pick browser: ${(err as Error).message}`,
      });
    }
  };

  const cancel = async () => {
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sid) await cancelRepickSession(sid);
    setPhase({ kind: "idle" });
    setAcknowledged(false);
  };

  const onImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (phase.kind !== "live" || phase.picking) return;
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    // Translate the click on the (possibly-scaled) screenshot back to
    // the viewport coordinates the server-side page sees.
    const scaleX = phase.session.viewport.width / rect.width;
    const scaleY = phase.session.viewport.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    setPhase({ ...phase, picking: true });
    try {
      const picked = await repickPick(phase.session.sessionId, x, y);
      const refreshed: RepickStartResult = {
        ...phase.session,
        screenshotBase64: picked.screenshotBase64,
      };
      setPhase({
        kind: "picked",
        session: refreshed,
        selector: picked.selector,
        strategy: picked.strategy,
        text: picked.text,
      });
    } catch (err) {
      setPhase({ ...phase, picking: false });
      toast.error(`Couldn't pick that element: ${(err as Error).message}`);
    }
  };

  const preview = async () => {
    if (phase.kind !== "picked") return;
    setBusy(true);
    try {
      const result = await fetchHealPreview(context.selector, phase.selector);
      setPhase({
        kind: "previewing",
        session: phase.session,
        selector: phase.selector,
        preview: result,
      });
    } catch (err) {
      toast.error(`Preview failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (phase.kind !== "previewing") return;
    setBusy(true);
    try {
      const data = await applyHeal(
        context.selector,
        phase.preview.newSelector,
        "repick",
      );
      toast.success(summarizeApply(data));
      // Close the session before unmounting so we don't leak Chromium.
      const sid = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sid) await cancelRepickSession(sid);
      onApplied();
    } catch (err) {
      toast.error(`Apply failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (phase.kind === "idle") {
    return (
      <div className="space-y-3" data-testid="fix-selector-tab-repick">
        <div className="rounded border border-dashed bg-muted/40 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MousePointerClick className="h-4 w-4" />
            Re-pick by clicking the element
          </div>
          <p className="text-xs text-muted-foreground">
            Memento will launch a fresh browser at{" "}
            <code className="text-[11px]">{context.pageUrl ?? "(unknown URL)"}</code>{" "}
            and show you a screenshot. Click the new location of the element
            and we'll capture a fresh selector using the same rules as
            initial recording — no copy/paste needed.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              onClick={start}
              disabled={!context.pageUrl}
              data-testid="button-repick-start"
            >
              <MousePointerClick className="h-3 w-3 mr-1" />
              Start re-pick session
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSwitchTab("ai")}
            >
              Try AI suggestion
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSwitchTab("advanced")}
            >
              Edit selector text
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase.kind === "starting") {
    return (
      <div
        className="py-10 text-center text-sm text-muted-foreground space-y-2"
        data-testid="fix-selector-repick-starting"
      >
        <Loader2 className="h-5 w-5 animate-spin mx-auto" />
        <div>Launching browser and loading the page…</div>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div
        className="rounded border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-3"
        data-testid="fix-selector-repick-error"
      >
        <div className="font-medium text-destructive">Re-pick unavailable</div>
        <p className="text-xs text-muted-foreground">{phase.message}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setPhase({ kind: "idle" })}>
            Try again
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onSwitchTab("advanced")}>
            Use Advanced instead
          </Button>
        </div>
      </div>
    );
  }

  // Live / picked / previewing all show the screenshot.
  return (
    <div className="space-y-3" data-testid="fix-selector-repick-live">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          Click the element on the screenshot below.
        </span>
        <Button size="sm" variant="ghost" onClick={cancel}>
          <X className="h-3 w-3 mr-1" />
          Cancel session
        </Button>
      </div>
      <div className="relative rounded border overflow-hidden bg-muted/20">
        <img
          ref={imgRef}
          src={`data:image/png;base64,${phase.session.screenshotBase64}`}
          alt="Page screenshot"
          onClick={onImageClick}
          className={
            "block w-full h-auto " +
            (phase.kind === "live" && !phase.picking
              ? "cursor-crosshair"
              : "cursor-default")
          }
          data-testid="repick-screenshot"
        />
        {phase.kind === "live" && phase.picking && (
          <div className="absolute inset-0 grid place-items-center bg-background/60">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
      </div>
      {(phase.kind === "picked" || phase.kind === "previewing") && (
        <div className="rounded border bg-muted/40 p-3 space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <RotateCw className="h-3 w-3" />
            <span className="font-medium">New selector captured</span>
            <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
              {phase.kind === "picked"
                ? phase.strategy
                : "ready"}
            </span>
          </div>
          <pre
            className="whitespace-pre-wrap break-all rounded bg-emerald-500/10 px-1.5 py-1 font-mono text-[11px] text-emerald-700 dark:text-emerald-300"
            data-testid="repick-captured-selector"
          >
            {phase.kind === "picked" ? phase.selector : phase.selector}
          </pre>
        </div>
      )}
      {phase.kind === "previewing" && (
        <HealPreviewPanel
          preview={phase.preview}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
        />
      )}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        {phase.kind === "picked" && (
          <Button
            size="sm"
            onClick={preview}
            disabled={busy}
            data-testid="button-repick-preview"
          >
            {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Preview replacement
          </Button>
        )}
        {phase.kind === "previewing" && (
          <Button
            size="sm"
            onClick={apply}
            disabled={
              busy || phase.preview.totalReplacements === 0 || !acknowledged
            }
            data-testid="button-repick-apply"
          >
            {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Accept &amp; apply
          </Button>
        )}
      </div>
    </div>
  );
}

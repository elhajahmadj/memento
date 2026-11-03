import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import {
  ArrowRight,
  ExternalLink,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  aiSuggestSelector,
  applyHeal,
  fetchHealPreview,
  isAiSuggestError,
  summarizeApply,
} from "./heal-api";
import { HealPreviewPanel } from "./preview-panel";
import type {
  AiAvailability,
  AiSuggestion,
  FixSelectorContext,
  HealResult,
} from "./types";

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "suggested"; suggestion: AiSuggestion; edited: string }
  | { kind: "previewing"; suggestion: AiSuggestion; preview: HealResult }
  | { kind: "no_key" }
  | { kind: "error"; message: string };

/**
 * "Fix with AI" path. Sends the failing step's context to the configured
 * provider, parses {suggestedSelector, confidence, explanation}, shows a
 * before/after diff, lets the user accept / edit / reject. When no AI
 * key is configured the empty state hands off to Tools → AI Agent and
 * to the manual tabs.
 */
export function AiTab({
  context,
  availability,
  onApplied,
  onSwitchTab,
  onEditAdvanced,
}: {
  context: FixSelectorContext;
  /** Pre-checked AI availability — when `available === false` the
   *  call-to-action is disabled with the server-supplied reason. */
  availability: AiAvailability | null;
  onApplied: () => void;
  onSwitchTab: (tab: "advanced" | "repick") => void;
  onEditAdvanced: (prefilled: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Availability is fetched after the dialog mounts, so we cannot
  // initialize `phase` from it inline — that snapshot is always
  // `null`. Sync via effect: once the probe resolves with
  // `available === false` flip into the `no_key` empty state so the
  // onboarding card + setup link are reachable on first open.
  useEffect(() => {
    if (!availability) return;
    if (availability.available === false) {
      setPhase((p) => (p.kind === "idle" ? { kind: "no_key" } : p));
    }
  }, [availability]);

  const run = async () => {
    setPhase({ kind: "loading" });
    try {
      const suggestion = await aiSuggestSelector(context);
      setPhase({
        kind: "suggested",
        suggestion,
        edited: suggestion.suggestedSelector,
      });
    } catch (err) {
      if (isAiSuggestError(err)) {
        if (err.status === 404 && err.kind === "not_found") {
          setPhase({ kind: "no_key" });
          return;
        }
        setPhase({ kind: "error", message: err.message });
        return;
      }
      setPhase({
        kind: "error",
        message: (err as Error).message ?? "Couldn't reach the AI provider.",
      });
    }
  };

  const previewWith = async (sel: string) => {
    if (phase.kind !== "suggested") return;
    const trimmed = sel.trim();
    if (!trimmed || trimmed === context.selector) {
      toast.error(
        trimmed === context.selector
          ? "That's the same as the broken selector — try editing it."
          : "Selector can't be empty.",
      );
      return;
    }
    setBusy(true);
    try {
      const preview = await fetchHealPreview(context.selector, trimmed);
      setPhase({ kind: "previewing", suggestion: phase.suggestion, preview });
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
        "ai",
        {
          provider: phase.suggestion.provider,
          model: phase.suggestion.model,
          confidence: phase.suggestion.confidence,
          tokensIn: phase.suggestion.tokensIn,
          tokensOut: phase.suggestion.tokensOut,
        },
      );
      toast.success(summarizeApply(data));
      onApplied();
    } catch (err) {
      toast.error(`Apply failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (phase.kind === "idle") {
    const checking = availability === null;
    const unavailable = !!availability && availability.available === false;
    // Pre-check via /selectors/heal/ai-available: if the server says
    // there's no key configured we DISABLE the button up-front and
    // surface a tooltip + setup link instead of letting the user click
    // through to a generic error.
    return (
      <div className="space-y-3" data-testid="fix-selector-tab-ai">
        <p className="text-xs text-muted-foreground">
          Memento will send the failing step's context to the AI provider
          configured in Tools → AI Agent and propose a replacement
          selector. You always preview and accept the change before it's
          applied — nothing happens silently.
        </p>
        <Button
          onClick={run}
          className="w-full"
          disabled={checking || unavailable}
          title={
            unavailable
              ? (availability?.message ??
                "No AI key configured. Open Tools → AI Agent to add one.")
              : checking
                ? "Checking AI availability…"
                : undefined
          }
          data-testid="button-ai-suggest"
        >
          {checking ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-2" />
          )}
          {checking
            ? "Checking AI availability…"
            : unavailable
              ? "AI unavailable — see Tools → AI Agent"
              : "Suggest a fix with AI"}
        </Button>
      </div>
    );
  }

  if (phase.kind === "loading") {
    return (
      <div
        className="py-10 text-center text-sm text-muted-foreground space-y-2"
        data-testid="fix-selector-ai-loading"
      >
        <Loader2 className="h-5 w-5 animate-spin mx-auto" />
        <div>Asking the AI for a replacement selector…</div>
        <div className="text-xs">This usually takes 5–15 seconds.</div>
      </div>
    );
  }

  if (phase.kind === "no_key") {
    return (
      <div
        className="rounded border border-dashed p-4 text-sm space-y-3"
        data-testid="fix-selector-ai-no-key"
      >
        <div className="font-medium">No AI key configured</div>
        <p className="text-xs text-muted-foreground">
          Add an AI provider key under <strong>Tools → AI Agent</strong>{" "}
          to enable one-click selector healing. Until then, the other two
          options below still work.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            size="sm"
            variant="outline"
            data-testid="button-ai-setup-link"
          >
            <a href="/tools/ai-agent" target="_blank" rel="noreferrer">
              <ExternalLink className="h-3 w-3 mr-1" />
              Open Tools → AI Agent
            </a>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onSwitchTab("repick")}
          >
            Use Re-pick instead
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onSwitchTab("advanced")}
          >
            Use Advanced instead
          </Button>
        </div>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div
        className="rounded border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-3"
        data-testid="fix-selector-ai-error"
      >
        <div className="font-medium text-destructive">
          The AI couldn't help this time
        </div>
        <p className="text-xs text-muted-foreground">{phase.message}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={run}>
            Try again
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onSwitchTab("repick")}
            data-testid="button-ai-switch-repick"
          >
            Switch to manual re-pick
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
    );
  }

  // Both `suggested` and `previewing` show the suggestion card.
  const suggestion =
    phase.kind === "suggested" ? phase.suggestion : phase.suggestion;
  const edited = phase.kind === "suggested" ? phase.edited : phase.preview.newSelector;

  return (
    <div className="space-y-3" data-testid="fix-selector-ai-result">
      <div className="rounded border bg-muted/40 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <Wand2 className="h-3 w-3" />
          <span className="font-medium">AI suggestion</span>
          <span
            className={
              "ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase " +
              (suggestion.confidence === "high"
                ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                : suggestion.confidence === "medium"
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                  : "bg-red-500/20 text-red-700 dark:text-red-300")
            }
            data-testid="ai-confidence"
          >
            {suggestion.confidence}
          </span>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="ai-explanation">
          {suggestion.explanation}
        </p>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Old selector
          </div>
          <pre className="whitespace-pre-wrap break-all rounded bg-red-500/10 px-1.5 py-0.5 text-[11px] font-mono text-red-700 dark:text-red-300">
            - {context.selector}
          </pre>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            New selector <ArrowRight className="h-2.5 w-2.5" />
          </div>
          {phase.kind === "suggested" ? (
            <input
              className="w-full rounded bg-emerald-500/10 px-1.5 py-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-300 outline-none focus:ring-1 focus:ring-emerald-500/40"
              value={phase.edited}
              onChange={(e) =>
                setPhase({ ...phase, edited: e.target.value })
              }
              data-testid="input-ai-edited"
            />
          ) : (
            <pre className="whitespace-pre-wrap break-all rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
              + {edited}
            </pre>
          )}
        </div>
      </div>

      {phase.kind === "previewing" && (
        <HealPreviewPanel
          preview={phase.preview}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
        />
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={run}
          disabled={busy}
          data-testid="button-ai-reject"
        >
          Reject &amp; try again
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onEditAdvanced(edited)}
          disabled={busy}
        >
          Edit in Advanced
        </Button>
        {phase.kind === "suggested" ? (
          <Button
            size="sm"
            onClick={() => previewWith(phase.edited)}
            disabled={busy || !phase.edited.trim()}
            data-testid="button-ai-preview"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : null}
            Preview replacement
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={apply}
            disabled={
              busy || phase.preview.totalReplacements === 0 || !acknowledged
            }
            data-testid="button-ai-apply"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : null}
            Accept &amp; apply
          </Button>
        )}
      </div>
    </div>
  );
}

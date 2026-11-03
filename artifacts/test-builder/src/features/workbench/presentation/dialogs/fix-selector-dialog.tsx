import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { MousePointerClick, Settings2, Sparkles } from "lucide-react";
import { AdvancedTab } from "./fix-selector/advanced-tab";
import { AiTab } from "./fix-selector/ai-tab";
import { RepickTab } from "./fix-selector/repick-tab";
import { fetchAiAvailability } from "./fix-selector/heal-api";
import { useIsGuest } from "@/features/auth/presentation/role";
import type {
  AiAvailability,
  FixSelectorContext,
  FixSelectorInitialTab,
} from "./fix-selector/types";

type TabKey = FixSelectorInitialTab;

/**
 * Three-path "Fix selector" dialog for non-coders.
 *
 *   • **Fix with AI** — sends the failing step's context to the
 *     configured AI provider and proposes a replacement selector. User
 *     always previews and accepts before anything is applied. Disabled
 *     state when no AI key is configured links to Tools → AI Agent and
 *     redirects to the manual paths.
 *   • **Re-pick element** — guides the user to capture a fresh selector
 *     by clicking the element in the recorder. (One-click in-dialog
 *     re-pick session is on the roadmap.)
 *   • **Edit selector text** — the existing power-user path: paste a
 *     Playwright/CSS selector, preview the dry-run diff, apply.
 *
 * Manual paths always work even when no AI key is set — AI is strictly
 * additive. The composing shell is intentionally thin (state lives in
 * each tab) so the dialog stays under the 200-line React budget.
 */
export function FixSelectorDialog({
  open,
  onOpenChange,
  context,
  onApplied,
  initialTab,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context: FixSelectorContext | null;
  onApplied?: () => void;
  /** Which tab to open on. Lets the validation row's "Fix with AI" /
   *  "Re-pick" buttons land users directly on the right path without
   *  forcing them to think about tabs. Defaults to "ai". */
  initialTab?: FixSelectorInitialTab;
}) {
  // Guests get the two deterministic paths only. `/selectors/heal/ai-*`
  // is closed to them server-side, so the AI tab is removed rather than
  // shown-and-broken, and the default tab moves to Re-pick.
  const isGuest = useIsGuest();
  const [tab, setTab] = useState<TabKey>(
    isGuest ? "repick" : (initialTab ?? "ai"),
  );
  // When the user clicks "Edit in Advanced" from the AI tab we
  // prefill the Advanced tab's input with the AI-suggested selector.
  const [advancedPrefill, setAdvancedPrefill] = useState<string | undefined>(
    undefined,
  );
  // Probe AI availability once on open so the AI tab can disable its
  // call-to-action up-front (with tooltip + setup link) instead of
  // letting the user click through to a 404. `null` = checking, the
  // object value carries the server's reason + message.
  const [aiAvailability, setAiAvailability] = useState<AiAvailability | null>(
    null,
  );

  useEffect(() => {
    if (!open) {
      setAdvancedPrefill(undefined);
      setAiAvailability(null);
      return;
    }
    // Reset tab to the requested initial each time the dialog opens
    // so consecutive "Fix with AI" → close → "Re-pick" clicks land
    // on the right tab. Guests can never land on "ai".
    setTab(isGuest ? "repick" : (initialTab ?? "ai"));
    if (isGuest) return;
    let cancelled = false;
    fetchAiAvailability().then((a) => {
      if (!cancelled) setAiAvailability(a);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleApplied = () => {
    onApplied?.();
    onOpenChange(false);
  };

  if (!context) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        data-testid="dialog-fix-selector"
      >
        <DialogHeader>
          <DialogTitle>Fix selector</DialogTitle>
          <DialogDescription>
            Replace the broken selector across every recording you own in
            the current project. Pick the path that works best for you —
            all three end in the same dry-run preview before anything is
            written.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Broken selector
          </div>
          <code className="block text-xs rounded bg-muted px-2 py-1 font-mono break-all">
            {context.selector}
          </code>
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabKey)}
          className="mt-2"
        >
          <TabsList
            className={isGuest ? "grid grid-cols-2" : "grid grid-cols-3"}
          >
            {!isGuest && (
              <TabsTrigger
                value="ai"
                data-testid="tab-ai"
                title={
                  aiAvailability && aiAvailability.available === false
                    ? (aiAvailability.message ??
                      "No AI key configured. Open Tools → AI Agent to add one.")
                    : undefined
                }
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Fix with AI
              </TabsTrigger>
            )}
            <TabsTrigger value="repick" data-testid="tab-repick">
              <MousePointerClick className="h-3.5 w-3.5 mr-1.5" />
              Re-pick element
            </TabsTrigger>
            <TabsTrigger value="advanced" data-testid="tab-advanced">
              <Settings2 className="h-3.5 w-3.5 mr-1.5" />
              Edit text
            </TabsTrigger>
          </TabsList>
          {!isGuest && (
            <TabsContent value="ai" className="mt-3">
              <AiTab
                context={context}
                availability={aiAvailability}
                onApplied={handleApplied}
                onSwitchTab={(t) => setTab(t)}
                onEditAdvanced={(prefilled) => {
                  setAdvancedPrefill(prefilled);
                  setTab("advanced");
                }}
              />
            </TabsContent>
          )}
          <TabsContent value="repick" className="mt-3">
            <RepickTab
              context={context}
              onSwitchTab={(t) => setTab(t)}
              onApplied={handleApplied}
            />
          </TabsContent>
          <TabsContent value="advanced" className="mt-3">
            <AdvancedTab
              oldSelector={context.selector}
              onApplied={handleApplied}
              initialNewSelector={advancedPrefill}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

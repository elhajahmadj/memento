import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Loader2 } from "lucide-react";
import {
  applyHeal,
  fetchHealPreview,
  summarizeApply,
} from "./heal-api";
import { HealPreviewPanel } from "./preview-panel";
import type { HealResult } from "./types";

/**
 * Advanced "edit selector text" path — the original power-user flow.
 * The user pastes/edits a Playwright/CSS selector, previews the diff,
 * and applies. Always available, even when no AI key is configured.
 */
export function AdvancedTab({
  oldSelector,
  onApplied,
  initialNewSelector,
}: {
  oldSelector: string;
  onApplied: () => void;
  initialNewSelector?: string | undefined;
}) {
  const [newSelector, setNewSelector] = useState(initialNewSelector ?? "");
  const [preview, setPreview] = useState<HealResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const trimmed = newSelector.trim();
  const canPreview = trimmed.length > 0 && trimmed !== oldSelector;

  const onPreview = async () => {
    if (!canPreview) return;
    setBusy(true);
    try {
      setPreview(await fetchHealPreview(oldSelector, trimmed));
    } catch (err) {
      toast.error(`Preview failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onApply = async () => {
    setBusy(true);
    try {
      const data = await applyHeal(oldSelector, trimmed, "advanced");
      toast.success(summarizeApply(data));
      onApplied();
    } catch (err) {
      toast.error(`Apply failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="fix-selector-tab-advanced">
      <p className="text-xs text-muted-foreground">
        For power users: paste or edit the exact Playwright/CSS selector
        string. The change is applied across every recording and
        selectors file in this project.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="new-selector">New selector</Label>
        <Input
          id="new-selector"
          value={newSelector}
          onChange={(e) => {
            setNewSelector(e.target.value);
            setPreview(null);
          }}
          placeholder='e.g. [data-testid="submit-button"]'
          data-testid="input-new-selector"
        />
      </div>
      {preview && (
        <HealPreviewPanel
          preview={preview}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
        />
      )}
      <div className="flex justify-end gap-2 pt-1">
        {preview ? (
          <Button
            onClick={onApply}
            disabled={busy || preview.totalReplacements === 0 || !acknowledged}
            data-testid="button-apply-heal"
          >
            {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Apply
          </Button>
        ) : (
          <Button
            onClick={onPreview}
            disabled={busy || !canPreview}
            data-testid="button-preview-heal"
          >
            {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Preview
          </Button>
        )}
      </div>
    </div>
  );
}

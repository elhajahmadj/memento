import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";

type WaitKind = "selector" | "networkidle" | "timeout";

export function AddWaitDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [kind, setKind] = useState<WaitKind>("selector");
  const [waitSelector, setWaitSelector] = useState("");
  const [waitMs, setWaitMs] = useState("500");

  useEffect(() => {
    if (!open) {
      setKind("selector");
      setWaitSelector("");
      setWaitMs("500");
    }
  }, [open]);

  // Hard cap for fixed-delay waits — Tier 2 reliability requirement.
  // Anything longer almost certainly means the user wants `waitFor` on a
  // selector or `networkidle` instead.
  const WAIT_TIMEOUT_MAX_MS = 30_000;

  const canSubmit =
    kind === "selector"
      ? waitSelector.trim().length > 0
      : kind === "timeout"
        ? Number.isFinite(Number(waitMs)) &&
          Number(waitMs) > 0 &&
          Number(waitMs) <= WAIT_TIMEOUT_MAX_MS
        : true;

  const submit = () => {
    if (!canSubmit) return;
    let detail: {
      waitKind: WaitKind;
      waitSelector?: string;
      waitMs?: number;
    };
    if (kind === "selector") {
      detail = { waitKind: "selector", waitSelector: waitSelector.trim() };
    } else if (kind === "timeout") {
      const ms = Math.floor(Number(waitMs));
      if (!Number.isFinite(ms) || ms <= 0) {
        toast.error("Timeout must be a positive number of milliseconds.");
        return;
      }
      if (ms > WAIT_TIMEOUT_MAX_MS) {
        toast.error(
          `Timeout waits are capped at ${WAIT_TIMEOUT_MAX_MS} ms — use a selector or networkidle wait instead.`,
        );
        return;
      }
      detail = { waitKind: "timeout", waitMs: ms };
    } else {
      detail = { waitKind: "networkidle" };
    }
    window.dispatchEvent(
      new CustomEvent("recorder:request-add-wait", { detail }),
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-add-wait">
        <DialogHeader>
          <DialogTitle>Add wait/sync step</DialogTitle>
          <DialogDescription>
            Insert an explicit Playwright wait into the recorded actions.
            Useful when the page lazily loads content or you need to slow the
            run down before a flaky step.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-2">
            <Label className="text-xs">Wait kind</Label>
            <RadioGroup
              value={kind}
              onValueChange={(v) => setKind(v as WaitKind)}
              className="grid gap-1.5"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="selector"
                  data-testid="radio-wait-selector"
                />
                Wait for selector to appear
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="networkidle"
                  data-testid="radio-wait-networkidle"
                />
                Wait for network to be idle
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="timeout"
                  data-testid="radio-wait-timeout"
                />
                Wait a fixed number of milliseconds
              </label>
            </RadioGroup>
          </div>
          {kind === "selector" && (
            <div className="space-y-1">
              <Label htmlFor="wait-selector" className="text-xs">
                Selector (Playwright locator)
              </Label>
              <Input
                id="wait-selector"
                value={waitSelector}
                onChange={(e) => setWaitSelector(e.target.value)}
                placeholder="text=Welcome  or  #header"
                className="font-mono"
                data-testid="input-wait-selector"
              />
            </div>
          )}
          {kind === "timeout" && (
            <div className="space-y-1">
              <Label htmlFor="wait-ms" className="text-xs">
                Milliseconds
              </Label>
              <Input
                id="wait-ms"
                type="number"
                inputMode="numeric"
                min={1}
                max={WAIT_TIMEOUT_MAX_MS}
                value={waitMs}
                onChange={(e) => setWaitMs(e.target.value)}
                data-testid="input-wait-ms"
              />
              <p className="text-[11px] text-muted-foreground">
                Capped at {WAIT_TIMEOUT_MAX_MS.toLocaleString()} ms. Prefer
                a selector or networkidle wait for anything longer.
              </p>
            </div>
          )}
          {kind === "networkidle" && (
            <p className="text-xs text-muted-foreground">
              Equivalent to <code>page.waitForLoadState(&quot;networkidle&quot;)</code>.
              No additional fields required.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-wait-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            data-testid="button-wait-add"
          >
            Add wait
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

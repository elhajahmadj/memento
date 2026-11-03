import { useEffect, useState } from "react";
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
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Loader2 } from "lucide-react";

interface SharedStepDto {
  id: string;
  name: string;
  description: string;
  actions: Array<{ type?: string; selector?: string; value?: string }>;
  createdAt: string;
  updatedAt: string;
}

interface ActionPositionHint {
  /** Number of live (non-deleted) actions currently in the feed. */
  liveCount: number;
  /**
   * Server-assigned session index of the action currently focused in the
   * actions feed (or `null` when nothing is focused). The macro will be
   * inserted *after* this action when chosen as the position.
   */
  focusedIndex: number | null;
  /** Optional human-friendly label for the focused action ("3. ClickLogin"). */
  focusedLabel?: string | null;
}

export function InsertSharedStepDialog({
  open,
  onOpenChange,
  position,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /**
   * Insert position hint. When the user has focused a row in the actions
   * feed, the dialog defaults to "After step #N"; otherwise it defaults
   * to "End of recording". `null` means "no live recording context"
   * (the dialog still works — just appends).
   */
  position?: ActionPositionHint | null;
}) {
  const [items, setItems] = useState<SharedStepDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [insertMode, setInsertMode] = useState<"end" | "after">("end");

  useEffect(() => {
    if (!open) {
      setSelected("");
      setInsertMode("end");
      return;
    }
    // Default to "after focused step" when the actions feed has a row
    // focused — that matches the spec's "insert inline at current
    // position" behavior. Otherwise default to "end of recording".
    if (position?.focusedIndex != null) setInsertMode("after");
    else setInsertMode("end");
    let cancelled = false;
    setLoading(true);
    fetch("/api/shared-steps", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((j: { items: SharedStepDto[] }) => {
        if (cancelled) return;
        setItems(j.items ?? []);
        if ((j.items ?? []).length > 0)
          setSelected(j.items[0]!.name);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(`Failed to load shared steps: ${(err as Error).message}`);
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const chosen = items?.find((s) => s.name === selected) ?? null;

  const computedAtIndex: number | null = (() => {
    if (insertMode === "end") return null;
    if (position?.focusedIndex == null) return null;
    // Insert *after* the focused server-assigned index. The server
    // splices into `session.actions[atIndex]`, so atIndex = focused + 1
    // lands the macro right after the focused row.
    return position.focusedIndex + 1;
  })();

  const submit = () => {
    if (!chosen) return;
    window.dispatchEvent(
      new CustomEvent("recorder:request-insert-shared-step", {
        detail: {
          name: chosen.name,
          ...(computedAtIndex !== null ? { atIndex: computedAtIndex } : {}),
        },
      }),
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-insert-shared-step"
      >
        <DialogHeader>
          <DialogTitle>Insert shared step</DialogTitle>
          <DialogDescription>
            Splice a saved RecordedAction macro into the current recording.
            Only steps you've saved in this project are available.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading…
            </div>
          ) : items && items.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              No shared steps saved yet. Visit Settings → Shared steps to
              create one.
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="shared-step-select">Step</Label>
                <Select value={selected} onValueChange={setSelected}>
                  <SelectTrigger
                    id="shared-step-select"
                    data-testid="select-shared-step"
                  >
                    <SelectValue placeholder="Pick a saved step" />
                  </SelectTrigger>
                  <SelectContent>
                    {(items ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.name}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shared-step-position">Insert position</Label>
                <Select
                  value={insertMode}
                  onValueChange={(v) => setInsertMode(v as "end" | "after")}
                >
                  <SelectTrigger
                    id="shared-step-position"
                    data-testid="select-shared-step-position"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="end">
                      End of recording
                      {position
                        ? ` (after step #${position.liveCount})`
                        : ""}
                    </SelectItem>
                    {position?.focusedIndex != null && (
                      <SelectItem value="after">
                        After focused step
                        {position.focusedLabel
                          ? ` — ${position.focusedLabel}`
                          : ""}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {insertMode === "after" && position?.focusedIndex == null && (
                  <p className="text-xs text-muted-foreground">
                    Click a step in the actions feed first to choose where
                    to insert.
                  </p>
                )}
              </div>
              {chosen && (
                <div className="rounded border bg-muted/40 p-2">
                  {chosen.description && (
                    <div className="text-xs text-muted-foreground mb-1">
                      {chosen.description}
                    </div>
                  )}
                  <ScrollArea className="max-h-40">
                    <ol className="text-xs font-mono space-y-0.5">
                      {chosen.actions.map((a, i) => (
                        <li key={i} className="text-foreground/80">
                          {i + 1}. {a.type ?? "step"}
                          {a.selector ? ` — ${a.selector}` : ""}
                          {a.value ? ` = ${a.value}` : ""}
                        </li>
                      ))}
                    </ol>
                  </ScrollArea>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!chosen}
            data-testid="button-insert-shared-step-confirm"
          >
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

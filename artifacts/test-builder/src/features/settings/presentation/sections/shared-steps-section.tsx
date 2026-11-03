import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { CollapsibleSection } from "../components/collapsible-section";
import { parseSharedStepActions } from "../../domain/shared-step-rules";

interface SharedStepDto {
  id: string;
  name: string;
  description: string;
  actions: Array<{ type?: string; selector?: string; value?: string }>;
  createdAt: string;
  updatedAt: string;
}

export function SharedStepsSection() {
  const [items, setItems] = useState<SharedStepDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [noProject, setNoProject] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorName, setEditorName] = useState("");
  const [editorDesc, setEditorDesc] = useState("");
  const [editorJson, setEditorJson] = useState(
    '[\n  {\n    "type": "click",\n    "selector": "[data-testid=\\"login\\"]",\n    "selectorStrategy": "css"\n  }\n]',
  );
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setLoading(true);
    setNoProject(false);
    fetch("/api/shared-steps", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.text();
          // "No project loaded" is an expected state for users who
          // haven't opened a project yet (e.g. fresh SSO sign-in) — it
          // is not a real failure. Render a friendly placeholder
          // instead of an alarming toast.
          if (
            (r.status === 400 || r.status === 404) &&
            /no project loaded/i.test(body)
          ) {
            setNoProject(true);
            setItems([]);
            return null;
          }
          throw new Error(body);
        }
        return r.json();
      })
      .then((j) => {
        if (!j) return;
        setItems(
          (j as { items: SharedStepDto[] | undefined }).items ?? [],
        );
      })
      .catch((err) => {
        toast.error(`Failed to load: ${(err as Error).message}`);
        setItems([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const submit = async () => {
    const parsed = parseSharedStepActions(editorJson);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/shared-steps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: editorName.trim(),
          description: editorDesc.trim(),
          actions: parsed.value,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success("Saved shared step.");
      setEditorOpen(false);
      setEditorName("");
      setEditorDesc("");
      refresh();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete shared step "${name}"?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/shared-steps/${encodeURIComponent(name)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success("Deleted.");
      refresh();
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CollapsibleSection
      title="Shared steps"
      description="Reusable RecordedAction macros — splice them into any new recording from the workbench."
    >
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            onClick={() => setEditorOpen(true)}
            disabled={noProject}
            data-testid="button-create-shared-step"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            New shared step
          </Button>
        </div>
        {loading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Loading…
          </div>
        ) : noProject ? (
          <p className="text-sm text-muted-foreground">
            Open a project to view and create shared steps.
          </p>
        ) : items && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None yet. Create one above.
          </p>
        ) : (
          <ul className="divide-y border rounded">
            {(items ?? []).map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between px-3 py-2"
                data-testid={`row-shared-step-${s.name}`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {s.description || "(no description)"} —{" "}
                    {s.actions.length} action
                    {s.actions.length === 1 ? "" : "s"}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => remove(s.name)}
                  disabled={busy}
                  data-testid={`button-delete-shared-step-${s.name}`}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={editorOpen} onOpenChange={(v) => !busy && setEditorOpen(v)}>
        <DialogContent
          className="sm:max-w-lg"
          data-testid="dialog-shared-step-editor"
        >
          <DialogHeader>
            <DialogTitle>New shared step</DialogTitle>
            <DialogDescription>
              Paste a RecordedAction array. The recorder splices it into the
              live actions list when you Insert it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="shared-step-name">Name</Label>
              <Input
                id="shared-step-name"
                value={editorName}
                onChange={(e) => setEditorName(e.target.value)}
                placeholder="LoginAsAdmin"
                data-testid="input-shared-step-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shared-step-desc">Description</Label>
              <Input
                id="shared-step-desc"
                value={editorDesc}
                onChange={(e) => setEditorDesc(e.target.value)}
                placeholder="Click login, fill creds, submit"
                data-testid="input-shared-step-desc"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shared-step-json">Actions (JSON)</Label>
              <Textarea
                id="shared-step-json"
                rows={8}
                className="font-mono text-xs"
                value={editorJson}
                onChange={(e) => setEditorJson(e.target.value)}
                data-testid="textarea-shared-step-json"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditorOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={busy || !editorName.trim()}
              data-testid="button-submit-shared-step"
            >
              {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CollapsibleSection>
  );
}

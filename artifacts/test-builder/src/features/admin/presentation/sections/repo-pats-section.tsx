import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, KeyRound, Plus, Pencil, Trash2 } from "lucide-react";
import {
  useListRepoPats,
  useCreateRepoPat,
  useUpdateRepoPat,
  useDeleteRepoPat,
  getListRepoPatsQueryKey,
  type RepoPat,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";

type Provider = "azure_repos" | "github";

const PROVIDER_LABEL: Record<Provider, string> = {
  azure_repos: "Azure Repos",
  github: "GitHub",
};

function extractErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === "object") {
    if ("data" in e) {
      const data = (e as { data: unknown }).data;
      if (data && typeof data === "object" && "error" in data) {
        const msg = (data as { error: unknown }).error;
        if (typeof msg === "string" && msg.trim()) return msg;
      }
    }
    if ("message" in e) {
      const msg = (e as { message: unknown }).message;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
  }
  return fallback;
}

interface EditorState {
  open: boolean;
  editingId: string | null;
  provider: Provider;
  name: string;
  pat: string;
  replacePat: boolean;
}

const EMPTY_EDITOR: EditorState = {
  open: false,
  editingId: null,
  provider: "azure_repos",
  name: "",
  pat: "",
  replacePat: true,
};

export function RepoPatsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useListRepoPats();
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [deleting, setDeleting] = useState<RepoPat | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListRepoPatsQueryKey() });

  const create = useCreateRepoPat({
    mutation: {
      onSuccess: async () => {
        toast.success("Repo PAT created");
        setEditor(EMPTY_EDITOR);
        await invalidate();
      },
      onError: (e: Error) =>
        toast.error(extractErrorMessage(e, "Failed to create PAT")),
    },
  });

  const update = useUpdateRepoPat({
    mutation: {
      onSuccess: async () => {
        toast.success("Repo PAT updated");
        setEditor(EMPTY_EDITOR);
        await invalidate();
      },
      onError: (e: Error) =>
        toast.error(extractErrorMessage(e, "Failed to update PAT")),
    },
  });

  const remove = useDeleteRepoPat({
    mutation: {
      onSuccess: async () => {
        toast.success("Repo PAT deleted");
        setDeleting(null);
        await invalidate();
      },
      onError: (e: Error) =>
        toast.error(extractErrorMessage(e, "Failed to delete PAT")),
    },
  });

  const openAdd = () => setEditor({ ...EMPTY_EDITOR, open: true });
  const openEdit = (row: RepoPat) =>
    setEditor({
      open: true,
      editingId: row.id,
      provider: row.provider as Provider,
      name: row.name,
      pat: "",
      replacePat: false,
    });

  const handleSave = () => {
    const name = editor.name.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    if (editor.editingId === null) {
      const pat = editor.pat.trim();
      if (!pat) {
        toast.error("Personal Access Token is required");
        return;
      }
      create.mutate({
        data: { provider: editor.provider, name, pat },
      });
      return;
    }
    const sendingPat = editor.replacePat ? editor.pat.trim() : null;
    if (editor.replacePat && !sendingPat) {
      toast.error("Personal Access Token is required");
      return;
    }
    update.mutate({
      id: editor.editingId,
      data: {
        provider: editor.provider,
        name,
        pat: sendingPat,
      },
    });
  };

  const rows = data ?? [];
  const saving = create.isPending || update.isPending;

  return (
    <div className="space-y-3" data-testid="section-repo-pats">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Manage reusable Git Personal Access Tokens that can be shared
          across multiple projects. Tokens are encrypted at rest and never
          returned in plain text.
        </p>
        <Button
          size="sm"
          onClick={openAdd}
          data-testid="button-repo-pats-add"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No Repo PATs yet. Click <span className="font-medium">Add</span>{" "}
          to create one.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-md border border-border bg-card px-4 py-3"
              data-testid={`row-repo-pats-${row.id}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{row.name}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {PROVIDER_LABEL[row.provider as Provider] ?? row.provider}{" "}
                    · PAT •••{row.patLastFour} · created{" "}
                    {new Date(row.createdAt).toLocaleDateString()} · updated{" "}
                    {new Date(row.updatedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(row)}
                    data-testid={`button-repo-pats-edit-${row.id}`}
                  >
                    <Pencil className="h-4 w-4 mr-1.5" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleting(row)}
                    data-testid={`button-repo-pats-delete-${row.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    Delete
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={editor.open}
        onOpenChange={(o) => !o && setEditor(EMPTY_EDITOR)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <KeyRound className="inline h-4 w-4 mr-1.5" />
              {editor.editingId ? "Edit Repo PAT" : "Add Repo PAT"}
            </DialogTitle>
            <DialogDescription>
              Reusable Git Personal Access Tokens are encrypted at rest and
              can be referenced from multiple projects.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="repo-pat-provider">Provider</Label>
              <Select
                value={editor.provider}
                onValueChange={(v) =>
                  setEditor((s) => ({ ...s, provider: v as Provider }))
                }
              >
                <SelectTrigger
                  id="repo-pat-provider"
                  data-testid="select-repo-pats-provider"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="azure_repos">Azure Repos</SelectItem>
                  <SelectItem value="github">GitHub</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="repo-pat-name">Name</Label>
              <Input
                id="repo-pat-name"
                value={editor.name}
                onChange={(e) =>
                  setEditor((s) => ({ ...s, name: e.target.value }))
                }
                placeholder="e.g. Shared CI token"
                data-testid="input-repo-pats-name"
              />
            </div>
            <div>
              <Label htmlFor="repo-pat-secret">Personal Access Token</Label>
              {editor.editingId && !editor.replacePat ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-sm text-muted-foreground">
                    Stored — leave unchanged or click Replace to set a new
                    value.
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setEditor((s) => ({ ...s, replacePat: true, pat: "" }))
                    }
                    data-testid="button-repo-pats-replace-pat"
                  >
                    Replace
                  </Button>
                </div>
              ) : (
                <Input
                  id="repo-pat-secret"
                  type="password"
                  value={editor.pat}
                  onChange={(e) =>
                    setEditor((s) => ({ ...s, pat: e.target.value }))
                  }
                  autoComplete="off"
                  data-testid="input-repo-pats-pat"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditor(EMPTY_EDITOR)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              data-testid="button-repo-pats-save"
            >
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Repo PAT?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the PAT named{" "}
              <span className="font-mono">{deleting?.name}</span>. If any
              project is currently bound to it, the delete will be blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-repo-pats-cancel-delete">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) remove.mutate({ id: deleting.id });
              }}
              disabled={remove.isPending}
              data-testid="button-repo-pats-confirm-delete"
            >
              {remove.isPending && (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

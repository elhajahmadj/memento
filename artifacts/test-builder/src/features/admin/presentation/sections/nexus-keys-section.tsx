import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, KeyRound, Trash2 } from "lucide-react";
import {
  useListNexusOrgConfigs,
  usePutNexusOrgConfig,
  useDeleteNexusOrgConfig,
  getListNexusOrgConfigsQueryKey,
  type NexusOrgConfig,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

function OrgRow({ row }: { row: NexusOrgConfig }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [apiKey, setApiKey] = useState("");

  const refresh = () =>
    qc.invalidateQueries({ queryKey: getListNexusOrgConfigsQueryKey() });

  const save = usePutNexusOrgConfig({
    mutation: {
      onSuccess: async () => {
        toast.success("IdP partner key saved");
        setEditing(false);
        setApiKey("");
        await refresh();
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to save IdP key"),
    },
  });

  const remove = useDeleteNexusOrgConfig({
    mutation: {
      onSuccess: async () => {
        toast.success("IdP partner key cleared");
        setConfirmClear(false);
        await refresh();
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to clear IdP key"),
    },
  });

  const handleSave = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      toast.error("API key is required");
      return;
    }
    save.mutate({
      orgId: row.organizationId,
      data: { apiKey: trimmed },
    });
  };

  return (
    <li
      className="rounded-md border border-border bg-card px-4 py-3"
      data-testid={`row-nexus-keys-${row.organizationId}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{row.organizationName}</div>
          {row.hasKey ? (
            <div
              className="text-xs text-muted-foreground font-mono truncate"
              data-testid={`text-nexus-keys-summary-${row.organizationId}`}
            >
              Configured · ••••{row.apiKeyLastFour}
              {row.updatedAt
                ? ` · set ${new Date(row.updatedAt).toLocaleDateString()}`
                : ""}
              {row.updatedByUsername ? ` by ${row.updatedByUsername}` : ""}
            </div>
          ) : (
            <div
              className="text-xs text-muted-foreground"
              data-testid={`text-nexus-keys-summary-${row.organizationId}`}
            >
              Not configured · using the deployment-wide fallback key if set
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            data-testid={`button-nexus-keys-edit-${row.organizationId}`}
          >
            <KeyRound className="h-4 w-4 mr-1.5" />
            {row.hasKey ? "Replace" : "Configure"}
          </Button>
          {row.hasKey && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmClear(true)}
              data-testid={`button-nexus-keys-clear-${row.organizationId}`}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      <Dialog open={editing} onOpenChange={(o) => !o && setEditing(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              IdP partner key — {row.organizationName}
            </DialogTitle>
            <DialogDescription>
              Paste an IdP partner API key (<span className="font-mono">nxk_…</span>)
              minted in your identity provider and scoped to this organization. It is
              encrypted at rest and never returned in plaintext. Replacing
              the key invalidates the previous one immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`nexus-key-${row.organizationId}`}>API key</Label>
            <Input
              id={`nexus-key-${row.organizationId}`}
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="nxk_…"
              data-testid={`input-nexus-keys-api-key-${row.organizationId}`}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={save.isPending}
              data-testid={`button-nexus-keys-save-${row.organizationId}`}
            >
              {save.isPending && (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmClear}
        onOpenChange={(o) => !o && setConfirmClear(false)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Clear IdP key for {row.organizationName}?
            </DialogTitle>
            <DialogDescription>
              The stored key will be deleted. New users provisioned for this
              org will fall back to the deployment-wide fallback key env var;
              if that is also unset, provisioning will return a 503 until a
              key is configured again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                remove.mutate({ orgId: row.organizationId })
              }
              disabled={remove.isPending}
              data-testid={`button-nexus-keys-confirm-clear-${row.organizationId}`}
            >
              {remove.isPending && (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              )}
              Clear key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export function NexusKeysSection() {
  const { data, isLoading } = useListNexusOrgConfigs();

  if (isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (!data || data.length === 0) {
    return (
      <div
        className="text-center py-10 text-sm text-muted-foreground"
        data-testid="text-nexus-keys-empty"
      >
        You don't administer any organization. IdP partner keys can only
        be managed by admins of the target organization (or by Memento
        Admins, who see every org).
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-testid="list-nexus-keys">
      {data.map((row) => (
        <OrgRow key={row.organizationId} row={row} />
      ))}
    </ul>
  );
}

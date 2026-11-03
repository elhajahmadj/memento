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
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Loader2 } from "lucide-react";

interface SavedAuthState {
  hasState: boolean;
  label: string | null;
  updatedAt: string | null;
}

interface CaptureLoginDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
}

/**
 * T002 — drives the workbench's "Capture login" flow:
 *  1. start a recorder session in CAPTURE mode at a chosen URL
 *  2. user logs in by hand in the live canvas
 *  3. "Save login" calls /auth-state/save (reads context.storageState)
 *  4. "Discard" finalizes the capture session without writing test code
 */
export function CaptureLoginDialog({
  open,
  onOpenChange,
  onChanged,
}: CaptureLoginDialogProps) {
  const [phase, setPhase] = useState<"setup" | "capturing">("setup");
  const [startUrl, setStartUrl] = useState("https://example.com");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<SavedAuthState | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase("setup");
      setBusy(false);
      setLabel("");
      return;
    }
    fetch("/api/auth-state", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: SavedAuthState | null) => setExisting(j))
      .catch(() => setExisting(null));
  }, [open]);

  const startCapture = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/recording/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          startUrl,
          urlName: "CaptureLoginUrl",
          target: "testMethod",
          methodName: "CaptureLoginSession",
          newTestClassName: "CaptureLoginSession",
          captureMode: true,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      setPhase("capturing");
      toast.success(
        "Capture session started — log in in the live canvas, then click Save login.",
      );
    } catch (err) {
      toast.error(`Could not start capture: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveLogin = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/auth-state/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ label: label.trim() }),
      });
      if (!r.ok) throw new Error(await r.text());
      // Discard the underlying capture session so no test code is
      // generated. Capture sessions short-circuit finalize on the
      // server, so this just closes the browser and clears state.
      await fetch("/api/recording/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode: "save" }),
      }).catch(() => {});
      toast.success("Saved login state.");
      onChanged?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(`Failed to save login: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await fetch("/api/recording/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode: "save" }),
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const removeSaved = async () => {
    if (!confirm("Delete the saved login state for this project?")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/auth-state", {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      setExisting({ hasState: false, label: null, updatedAt: null });
      onChanged?.();
      toast.success("Deleted saved login state.");
    } catch (err) {
      toast.error(`Failed to delete: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        // If the user closes the dialog mid-capture, discard the session
        // so no orphan recording is left running on the server.
        if (!v && phase === "capturing") void discard();
        else onOpenChange(v);
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-capture-login"
      >
        <DialogHeader>
          <DialogTitle>Capture login</DialogTitle>
          <DialogDescription>
            Save your logged-in cookies and localStorage so future
            recordings start already signed in. Capture sessions never
            generate test code.
          </DialogDescription>
        </DialogHeader>
        {phase === "setup" ? (
          <div className="space-y-3 py-1">
            {existing?.hasState && (
              <div className="rounded border bg-muted/40 p-2 text-xs">
                A saved login already exists{" "}
                {existing.label ? `("${existing.label}") ` : ""}from{" "}
                {existing.updatedAt
                  ? new Date(existing.updatedAt).toLocaleString()
                  : "unknown"}
                .{" "}
                <Button
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={removeSaved}
                  disabled={busy}
                  data-testid="button-delete-saved-login"
                >
                  Delete
                </Button>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="capture-url">Login page URL</Label>
              <Input
                id="capture-url"
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                placeholder="https://app.example.com/login"
                data-testid="input-capture-url"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="capture-label">Label (optional)</Label>
              <Input
                id="capture-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="QA admin user"
                data-testid="input-capture-label"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <p className="text-sm">
              Recorder is running. Switch to the live canvas, log in, then
              come back and click <strong>Save login</strong>.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="capture-label-2">Label (optional)</Label>
              <Input
                id="capture-label-2"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="QA admin user"
                data-testid="input-capture-label-2"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          {phase === "setup" ? (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                onClick={startCapture}
                disabled={busy || !startUrl.trim()}
                data-testid="button-start-capture"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : null}
                Start capture
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={discard}
                disabled={busy}
                data-testid="button-discard-capture"
              >
                Discard
              </Button>
              <Button
                onClick={saveLogin}
                disabled={busy}
                data-testid="button-save-login"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : null}
                Save login
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useOpenRecordingBrowser,
  getGetRecordingStatusQueryKey,
} from "@workspace/api-client-react";
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

/**
 * Small dialog used by the workbench Actions menu's "Open Browser"
 * entry. Submitting calls `POST /api/recording/open-browser` and, on
 * success, the workbench's recording-status poll picks up the new
 * pre-attach session and swaps the UI into open-browser mode. The
 * URL the user lands on is deliberately NOT persisted to the
 * project's named-URL store (the server enforces this).
 */
export function OpenBrowserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("https://example.com");

  useEffect(() => {
    if (open) setUrl("https://example.com");
  }, [open]);

  const openBrowser = useOpenRecordingBrowser({
    mutation: {
      onSuccess: async () => {
        toast.success("Browser opened");
        await qc.invalidateQueries({
          queryKey: getGetRecordingStatusQueryKey(),
        });
        onOpenChange(false);
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to open browser"),
    },
  });

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error("URL is required");
      return;
    }
    openBrowser.mutate({ data: { url: trimmed } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-open-browser">
        <DialogHeader>
          <DialogTitle>Enter URL to navigate to</DialogTitle>
          <DialogDescription>
            A headless Chromium session will open at this URL. You can
            navigate, log in, and set up state by hand before starting
            the recording.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="open-browser-url">URL</Label>
          <Input
            id="open-browser-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            data-testid="input-open-browser-url"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-open-browser-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={openBrowser.isPending}
            data-testid="button-open-browser-confirm"
          >
            {openBrowser.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

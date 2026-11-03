import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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

/**
 * "Name your JMX file" dialog — the JMX-mode equivalent of the
 * Playwright Start Recording dialog. A single text input collects the
 * `.jmx` filename, which is normalized server-side
 * (`normalizeJmxFileName` strips path segments and forces the `.jmx`
 * extension). On confirm, we hand the filename to the caller, which
 * fires `POST /jmx/recording/start`.
 *
 * Validation here mirrors the server's `normalizeJmxFileName`:
 *   - non-empty after trim
 *   - no `..` / `.` path segments
 * The server rejects anything else with a 400; the dialog stays open
 * and the toast surfaces the message.
 */
export function NameJmxFileDialog({
  open,
  onOpenChange,
  defaultFileName,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultFileName: string;
  onConfirm: (jmxFileName: string) => void;
  isPending: boolean;
}) {
  const [value, setValue] = useState(defaultFileName);

  useEffect(() => {
    if (open) setValue(defaultFileName);
  }, [open, defaultFileName]);

  const trimmed = value.trim();
  const hasTraversal = trimmed
    .split(/[\\/]/)
    .some((seg) => seg === ".." || seg === ".");
  const invalid = trimmed === "" || hasTraversal;

  const handleConfirm = () => {
    if (invalid || isPending) return;
    onConfirm(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Name your JMX file</DialogTitle>
          <DialogDescription>
            The captured HTTP traffic will be emitted as a JMeter `.jmx`
            plan under this name when you stop recording.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="jmx-file-name">File name</Label>
          <Input
            id="jmx-file-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
            }}
            data-testid="input-jmx-file-name"
            autoFocus
          />
          {hasTraversal && (
            <div className="text-xs text-destructive">
              File name must not contain `..` or `.` path segments.
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Saved under <code>jmx/{trimmed || "recording-1.jmx"}</code>.
            The `.jmx` extension is added automatically if you omit it.
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={invalid || isPending}
            data-testid="button-confirm-start-jmx-recording"
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

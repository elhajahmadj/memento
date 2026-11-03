import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import {
  useGetHookBackupRetention,
  useSetHookBackupRetention,
  getGetHookBackupRetentionQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  HOOK_BACKUP_RETENTION_BOUNDS,
  validateRetention,
} from "../../domain/retention-rules";

export function RecordingSettingsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useGetHookBackupRetention();
  const [value, setValue] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.retention != null) {
      setValue(String(data.retention));
    }
  }, [data?.retention]);

  const updateRetention = useSetHookBackupRetention({
    mutation: {
      onSuccess: async (resp) => {
        toast.success(
          `Keeping up to ${resp.retention} backup${resp.retention === 1 ? "" : "s"} per hook`,
        );
        await qc.invalidateQueries({
          queryKey: getGetHookBackupRetentionQueryKey(),
        });
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to update retention"),
    },
  });

  const handleSave = () => {
    setError(null);
    const result = validateRetention(
      value,
      HOOK_BACKUP_RETENTION_BOUNDS.min,
      HOOK_BACKUP_RETENTION_BOUNDS.max,
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    updateRetention.mutate({ data: { retention: result.value } });
  };

  const dirty =
    data?.retention != null && value.trim() !== String(data.retention);

  return (
    <section data-testid="section-recording-settings">
      <div className="rounded-md border border-border bg-card p-4 shadow-card">
        <Label htmlFor="input-hook-backup-retention" className="font-medium">
          Hook backup history
        </Label>
        <p className="text-sm text-muted-foreground mt-1 mb-3">
          When a recording overwrites a setup hook, the previous body is saved
          as a <code className="font-mono text-xs">.bak</code> file. Keep up to
          this many backups per (test class, hook) pair before the oldest are
          pruned. Defaults to 5.
        </p>
        <div className="flex items-center gap-2">
          <Input
            id="input-hook-backup-retention"
            data-testid="input-hook-backup-retention"
            type="number"
            min={1}
            max={100}
            step={1}
            inputMode="numeric"
            className="w-28"
            value={value}
            disabled={isLoading || updateRetention.isPending}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty) handleSave();
            }}
          />
          <Button
            onClick={handleSave}
            disabled={
              isLoading ||
              updateRetention.isPending ||
              !dirty ||
              !value.trim()
            }
            data-testid="button-save-hook-backup-retention"
          >
            {updateRetention.isPending && (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            )}
            <Save className="h-4 w-4 mr-1.5" />
            Save
          </Button>
        </div>
        {error && (
          <p
            className="text-sm text-destructive mt-2"
            data-testid="error-hook-backup-retention"
          >
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

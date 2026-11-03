import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import {
  useGetValidationTraceRetention,
  useSetValidationTraceRetention,
  getGetValidationTraceRetentionQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  VALIDATION_TRACE_RETENTION_BOUNDS,
  validateRetention,
} from "../../domain/retention-rules";

export function ValidationSettingsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useGetValidationTraceRetention();
  const [value, setValue] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.retentionDays != null) {
      setValue(String(data.retentionDays));
    }
  }, [data?.retentionDays]);

  const updateRetention = useSetValidationTraceRetention({
    mutation: {
      onSuccess: async (resp) => {
        toast.success(
          `Keeping validation traces for ${resp.retentionDays} day${resp.retentionDays === 1 ? "" : "s"}`,
        );
        await qc.invalidateQueries({
          queryKey: getGetValidationTraceRetentionQueryKey(),
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
      VALIDATION_TRACE_RETENTION_BOUNDS.min,
      VALIDATION_TRACE_RETENTION_BOUNDS.max,
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    updateRetention.mutate({ data: { retentionDays: result.value } });
  };

  const dirty =
    data?.retentionDays != null &&
    value.trim() !== String(data.retentionDays);

  return (
    <section data-testid="section-validation-settings">
      <div className="rounded-md border border-border bg-card p-4 shadow-card">
        <Label
          htmlFor="input-validation-trace-retention"
          className="font-medium"
        >
          Validation trace retention (days)
        </Label>
        <p className="text-sm text-muted-foreground mt-1 mb-3">
          Each validation run leaves behind a trace zip and a final-state
          screenshot. Files older than this many days are deleted by the
          background cleanup job. Defaults to 7.
        </p>
        <div className="flex items-center gap-2">
          <Input
            id="input-validation-trace-retention"
            data-testid="input-validation-trace-retention"
            type="number"
            min={1}
            max={365}
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
            data-testid="button-save-validation-trace-retention"
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
            data-testid="error-validation-trace-retention"
          >
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

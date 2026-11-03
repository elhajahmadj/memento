import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useGetAiAgentProjectConfig,
  usePutAiAgentProjectConfig,
  getGetAiAgentProjectConfigQueryKey,
  type AiAgentKey,
} from "@workspace/api-client-react";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { ORG_DEFAULT_OPTION } from "./constants";
import { formatKeyLabel } from "./helpers";

export function ProjectRow({
  projectName,
  keys,
  keysLoading,
}: {
  projectName: string;
  keys: AiAgentKey[];
  keysLoading: boolean;
}) {
  const qc = useQueryClient();
  const key = getGetAiAgentProjectConfigQueryKey(projectName);
  const { data, isLoading } = useGetAiAgentProjectConfig(projectName, {
    query: { queryKey: key },
  });
  const putCfg = usePutAiAgentProjectConfig({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: key }),
      onError: (e: unknown) =>
        toast.error(`Save failed: ${(e as Error).message ?? ""}`),
    },
  });

  const defaultKey = keys.find((k) => k.isDefault) ?? null;
  const overrideId = data?.aiKeyId ?? null;
  const overrideKey = overrideId
    ? (keys.find((k) => k.id === overrideId) ?? null)
    : null;
  const overrideMissing = overrideId !== null && overrideKey === null;
  const resolvedKey = overrideKey ?? defaultKey;
  const selectValue = overrideId ?? ORG_DEFAULT_OPTION;
  const enabled = !!data?.enabled;
  const busy = isLoading || keysLoading || putCfg.isPending;

  return (
    <div
      className="border rounded-md px-3 py-3 space-y-3"
      data-testid={`row-ai-project-${projectName}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm">{projectName}</span>
        <Switch
          disabled={busy}
          checked={enabled}
          onCheckedChange={(v) =>
            putCfg.mutate({
              projectName,
              data: { enabled: v },
            })
          }
          data-testid={`switch-ai-project-${projectName}`}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 md:items-end">
        <div>
          <Label className="text-xs">AI Key</Label>
          <Select
            value={selectValue}
            disabled={busy}
            onValueChange={(v) =>
              putCfg.mutate({
                projectName,
                data: {
                  enabled,
                  aiKeyId: v === ORG_DEFAULT_OPTION ? null : v,
                },
              })
            }
          >
            <SelectTrigger
              data-testid={`select-ai-project-key-${projectName}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ORG_DEFAULT_OPTION}>
                {defaultKey
                  ? `Use org default (${defaultKey.name})`
                  : "Use org default (none set)"}
              </SelectItem>
              {keys.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {formatKeyLabel(k)}
                  {k.isDefault ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {overrideMissing ? (
        <p
          className="text-xs text-destructive"
          data-testid={`text-ai-project-key-missing-${projectName}`}
        >
          The selected key was deleted. Pick another or fall back to the org
          default.{" "}
          <a
            href="/tools/ai-agent#keys"
            className="underline"
            data-testid={`link-ai-project-key-library-${projectName}`}
          >
            Manage AI Keys
          </a>
          .
        </p>
      ) : resolvedKey ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid={`text-ai-project-key-current-${projectName}`}
        >
          Currently using: {formatKeyLabel(resolvedKey)}
          {overrideKey ? " (project override)" : " (org default)"}
        </p>
      ) : (
        <p
          className="text-xs text-destructive"
          data-testid={`text-ai-project-key-none-${projectName}`}
        >
          No key configured. Set an org default or pick a project override in
          the{" "}
          <a
            href="/tools/ai-agent#keys"
            className="underline"
            data-testid={`link-ai-project-key-library-${projectName}`}
          >
            AI Keys library
          </a>
          .
        </p>
      )}
    </div>
  );
}

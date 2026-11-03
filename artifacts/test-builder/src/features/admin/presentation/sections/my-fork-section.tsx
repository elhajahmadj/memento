import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, GitFork } from "lucide-react";
import {
  useGetMyProjectFork,
  usePutMyProjectFork,
  useDeleteMyProjectFork,
  getGetMyProjectForkQueryKey,
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

type Provider = "azure_repos" | "github";

const PROVIDER_PLACEHOLDER: Record<Provider, string> = {
  azure_repos: "https://dev.azure.com/me/myproj/_git/myfork",
  github: "https://github.com/me/myfork.git",
};

export function MyForkSection({ projectName }: { projectName: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useGetMyProjectFork(projectName);
  const [provider, setProvider] = useState<Provider>("azure_repos");
  const [repoUrl, setRepoUrl] = useState("");
  const [pat, setPat] = useState("");
  const [replacePat, setReplacePat] = useState(false);

  const configured = !!data?.configured;

  useEffect(() => {
    if (data) {
      setProvider((data.provider as Provider | null) ?? "azure_repos");
      setRepoUrl(data.repoUrl ?? "");
      setReplacePat(!data.configured);
      setPat("");
    }
  }, [data]);

  const save = usePutMyProjectFork({
    mutation: {
      onSuccess: async () => {
        toast.success("Personal fork saved — pushes will target your fork");
        await qc.invalidateQueries({
          queryKey: getGetMyProjectForkQueryKey(projectName),
        });
        setPat("");
        setReplacePat(false);
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to save fork"),
    },
  });

  const clear = useDeleteMyProjectFork({
    mutation: {
      onSuccess: async () => {
        toast.success(
          "Personal fork cleared — pushes will now target the shared upstream",
        );
        await qc.invalidateQueries({
          queryKey: getGetMyProjectForkQueryKey(projectName),
        });
        setRepoUrl("");
        setPat("");
        setReplacePat(true);
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to clear fork"),
    },
  });

  const handleSave = () => {
    if (!repoUrl.trim()) {
      toast.error("Repository URL is required");
      return;
    }
    const sendingPat = replacePat ? pat.trim() : null;
    if (replacePat && !sendingPat) {
      toast.error("Personal Access Token is required");
      return;
    }
    save.mutate({
      projectName,
      data: {
        provider,
        repoUrl: repoUrl.trim(),
        pat: sendingPat,
      },
    });
  };

  return (
    <div
      className="rounded-md border border-dashed border-border p-3 space-y-3"
      data-testid={`section-my-fork-${projectName}`}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <GitFork className="h-4 w-4" />
        My fork (push target)
      </div>
      <p className="text-xs text-muted-foreground">
        Optional. When set, your Push targets this fork instead of the shared
        upstream. Pull always uses the shared upstream. Only you can see or
        edit this.
      </p>
      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div>
            <Label htmlFor={`my-fork-provider-${projectName}`}>Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as Provider)}
            >
              <SelectTrigger
                id={`my-fork-provider-${projectName}`}
                data-testid={`select-my-fork-provider-${projectName}`}
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
            <Label htmlFor={`my-fork-url-${projectName}`}>
              Fork repository URL
            </Label>
            <Input
              id={`my-fork-url-${projectName}`}
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder={PROVIDER_PLACEHOLDER[provider]}
              data-testid={`input-my-fork-url-${projectName}`}
            />
          </div>
          <div>
            <Label htmlFor={`my-fork-pat-${projectName}`}>
              Personal Access Token
            </Label>
            {configured && !replacePat ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 text-sm text-muted-foreground font-mono">
                  •••{data!.patLastFour} (set{" "}
                  {data!.patSetAt
                    ? new Date(data!.patSetAt).toLocaleDateString()
                    : ""}
                  )
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setReplacePat(true)}
                  data-testid={`button-my-fork-replace-pat-${projectName}`}
                >
                  Replace
                </Button>
              </div>
            ) : (
              <Input
                id={`my-fork-pat-${projectName}`}
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                autoComplete="off"
                data-testid={`input-my-fork-pat-${projectName}`}
              />
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            {configured && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => clear.mutate({ projectName })}
                disabled={clear.isPending}
                data-testid={`button-my-fork-clear-${projectName}`}
              >
                {clear.isPending && (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                )}
                Clear fork
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={save.isPending}
              data-testid={`button-my-fork-save-${projectName}`}
            >
              {save.isPending && (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              )}
              Save fork
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

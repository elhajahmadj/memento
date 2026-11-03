import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  GitBranch,
  Download,
  Upload,
} from "lucide-react";
import { Link } from "wouter";
import {
  useListAvailableProjects,
  useGetProjectGitConfig,
  usePutProjectGitConfig,
  usePullProjectGitConfig,
  usePushProjectGitConfig,
  useListRepoPats,
  getGetProjectGitConfigQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
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
import { MyForkSection } from "./my-fork-section";

type Provider = "azure_repos" | "github";
type ProviderMode = Provider | "existing_pat";

const PROVIDER_LABEL: Record<Provider, string> = {
  azure_repos: "Azure Repos",
  github: "GitHub",
};

type GitErrorCopy = { title: string; description: string };

const PUSH_ERROR_COPY: Record<string, GitErrorCopy> = {
  push_rejected: {
    title: "Push rejected",
    description:
      "The remote branch has new commits that aren't in your local copy. Pull first, then push again.",
  },
  auth_failed: {
    title: "Authentication failed",
    description:
      "The stored Personal Access Token was rejected by the remote. Open Configure and replace the PAT.",
  },
  repo_not_found: {
    title: "Repository not found",
    description:
      "The configured repository URL could not be reached. Open Configure to verify the URL.",
  },
  branch_not_found: {
    title: "Branch not found",
    description:
      "The configured branch does not exist on the remote.",
  },
  git_failed: {
    title: "Push failed",
    description: "git reported an error while pushing.",
  },
};

const PULL_ERROR_COPY: Record<string, GitErrorCopy> = {
  auth_failed: {
    title: "Authentication failed",
    description:
      "The stored Personal Access Token was rejected by the remote. Open Configure and replace the PAT.",
  },
  repo_not_found: {
    title: "Repository not found",
    description:
      "The configured repository URL could not be reached. Open Configure to verify the URL.",
  },
  branch_not_found: {
    title: "Branch not found",
    description:
      "The configured branch does not exist on the remote.",
  },
  not_a_memento_project: {
    title: "Not a memento project",
    description:
      "The remote branch does not contain a memento project layout.",
  },
  git_failed: {
    title: "Pull failed",
    description: "git reported an error while pulling.",
  },
};

function extractErrorCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "data" in e) {
    const data = (e as { data: unknown }).data;
    if (data && typeof data === "object" && "errorCode" in data) {
      const code = (data as { errorCode: unknown }).errorCode;
      if (typeof code === "string") return code;
    }
  }
  return undefined;
}

function extractServerMessage(e: unknown): string | undefined {
  if (e && typeof e === "object" && "data" in e) {
    const data = (e as { data: unknown }).data;
    if (data && typeof data === "object" && "message" in data) {
      const msg = (data as { message: unknown }).message;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
  }
  return undefined;
}

const PROVIDER_PLACEHOLDER: Record<Provider, string> = {
  azure_repos: "https://dev.azure.com/org/project/_git/repo",
  github: "https://github.com/owner/repo.git",
};

function ProjectRow({ projectName }: { projectName: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useGetProjectGitConfig(projectName);
  const [editing, setEditing] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);
  const [providerMode, setProviderMode] = useState<ProviderMode>("azure_repos");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [pat, setPat] = useState("");
  const [replacePat, setReplacePat] = useState(false);
  const [repoPatId, setRepoPatId] = useState<string>("");
  const [pushOpen, setPushOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");

  // Repo PATs are only fetched while the dialog is open so we don't
  // hammer the endpoint for every row on the page.
  const { data: repoPats, isLoading: repoPatsLoading } = useListRepoPats({
    query: { queryKey: ["listRepoPats"], enabled: editing },
  });

  const currentProvider: Provider =
    (data?.provider as Provider | undefined) ?? "azure_repos";
  const usesExistingPat = !!data?.repoPatId;

  const open = () => {
    if (usesExistingPat) {
      setProviderMode("existing_pat");
      setRepoPatId(data?.repoPatId ?? "");
      setReplacePat(false);
    } else {
      setProviderMode(currentProvider);
      setRepoPatId("");
      setReplacePat(!data?.patSetAt);
    }
    setRepoUrl(data?.repoUrl ?? "");
    setBranch(data?.branch ?? "main");
    setPat("");
    setEditing(true);
  };

  const save = usePutProjectGitConfig({
    mutation: {
      onSuccess: async () => {
        toast.success("Git provider configuration saved");
        setEditing(false);
        await qc.invalidateQueries({
          queryKey: getGetProjectGitConfigQueryKey(projectName),
        });
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to save"),
    },
  });

  const showPullError = (
    code: string | undefined,
    serverMessage: string | undefined,
  ) => {
    const copy: GitErrorCopy = (code ? PULL_ERROR_COPY[code] : undefined) ?? {
      title: "Pull failed",
      description: serverMessage ?? "The pull could not be completed.",
    };
    toast.error(copy.title, { description: copy.description });
  };

  const showPushError = (
    code: string | undefined,
    serverMessage: string | undefined,
  ) => {
    const copy: GitErrorCopy = (code ? PUSH_ERROR_COPY[code] : undefined) ?? {
      title: "Push failed",
      description: serverMessage ?? "The push could not be completed.",
    };
    if (code === "push_rejected") {
      toast.error(copy.title, {
        description: copy.description,
        action: {
          label: "Pull and retry",
          onClick: () => {
            setPushOpen(false);
            setCommitMessage("");
            setConfirmPull(true);
          },
        },
      });
      return;
    }
    toast.error(copy.title, { description: copy.description });
  };

  const pull = usePullProjectGitConfig({
    mutation: {
      onSuccess: async (res) => {
        if (res.ok) {
          const sha = res.commitSha?.slice(0, 7) ?? "";
          const subject = res.commitMessage?.trim();
          toast.success(
            subject ? `Pulled ${sha} — ${subject}` : `Pulled ${sha}`,
          );
        } else {
          showPullError(res.errorCode ?? undefined, res.message ?? undefined);
        }
        setConfirmPull(false);
      },
      onError: (e: Error) =>
        showPullError(extractErrorCode(e), extractServerMessage(e)),
    },
  });

  const push = usePushProjectGitConfig({
    mutation: {
      onSuccess: async (res) => {
        if (res.ok) {
          if (res.nothingToCommit) {
            toast.info("Nothing to push — working copy matches the remote.");
          } else {
            const sha = res.commitSha?.slice(0, 7) ?? "";
            toast.success(`Pushed ${sha} to ${data?.branch}`);
          }
          setPushOpen(false);
          setCommitMessage("");
        } else {
          showPushError(res.errorCode ?? undefined, res.message ?? undefined);
        }
      },
      onError: (e: Error) =>
        showPushError(extractErrorCode(e), extractServerMessage(e)),
    },
  });

  const handleSave = () => {
    if (!repoUrl.trim()) {
      toast.error("Repository URL is required");
      return;
    }
    if (!branch.trim()) {
      toast.error("Branch is required");
      return;
    }
    if (providerMode === "existing_pat") {
      if (!repoPatId) {
        toast.error("Pick an existing Repo PAT");
        return;
      }
      save.mutate({
        projectName,
        data: {
          provider: "existing_pat",
          repoUrl: repoUrl.trim(),
          branch: branch.trim(),
          pat: null,
          repoPatId,
        },
      });
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
        provider: providerMode,
        repoUrl: repoUrl.trim(),
        branch: branch.trim(),
        pat: sendingPat,
        repoPatId: null,
      },
    });
  };

  const isConfigured = !!data?.patSetAt || usesExistingPat;
  const providerLabel = PROVIDER_LABEL[currentProvider];

  return (
    <li
      className="rounded-md border border-border bg-card px-4 py-3"
      data-testid={`row-git-repos-${projectName}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{projectName}</div>
          {isLoading ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : isConfigured ? (
            <div
              className="text-xs text-muted-foreground font-mono truncate"
              data-testid={`text-git-repos-summary-${projectName}`}
            >
              {providerLabel} · {data!.repoUrl} · {data!.branch} ·{" "}
              {usesExistingPat
                ? `Existing PAT: ${providerLabel} - ${data!.repoPatName ?? ""}`
                : `PAT •••${data!.patLastFour}`}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Not configured
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={open}
            data-testid={`button-git-repos-edit-${projectName}`}
          >
            <GitBranch className="h-4 w-4 mr-1.5" />
            {isConfigured ? "Edit" : "Configure"}
          </Button>
          {isConfigured && (
            <>
              <Button
                variant="default"
                size="sm"
                onClick={() => setConfirmPull(true)}
                disabled={pull.isPending}
                data-testid={`button-git-repos-pull-${projectName}`}
              >
                {pull.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1.5" />
                )}
                Pull from {providerLabel}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setPushOpen(true)}
                disabled={push.isPending}
                data-testid={`button-git-repos-push-${projectName}`}
              >
                {push.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-1.5" />
                )}
                Push to {providerLabel}
              </Button>
            </>
          )}
        </div>
      </div>

      <Dialog open={editing} onOpenChange={(o) => !o && setEditing(false)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Project Git Repos — {projectName}</DialogTitle>
            <DialogDescription>
              Pick a Git provider and store the HTTPS clone URL, branch, and
              a Personal Access Token for this project. The PAT is encrypted
              at rest.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor={`git-provider-${projectName}`}>Provider</Label>
              <Select
                value={providerMode}
                onValueChange={(v) => {
                  const next = v as ProviderMode;
                  setProviderMode(next);
                  // Switching back to an inline provider when the
                  // current row has no inline PAT on file (fresh row,
                  // or row currently bound to a shared Repo PAT) must
                  // force the PAT input open — otherwise Save would
                  // send `pat: null` and the server would reject it
                  // with "provide a new PAT to switch to inline".
                  if (next !== "existing_pat" && !data?.patSetAt) {
                    setReplacePat(true);
                  }
                }}
              >
                <SelectTrigger
                  id={`git-provider-${projectName}`}
                  data-testid={`select-git-repos-provider-${projectName}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="azure_repos">Azure Repos</SelectItem>
                  <SelectItem value="github">GitHub</SelectItem>
                  <SelectItem value="existing_pat">
                    Existing Repo PAT
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {providerMode === "existing_pat" && (
              <div>
                <Label htmlFor={`git-repo-pat-${projectName}`}>
                  Existing Repo PAT
                </Label>
                {repoPatsLoading ? (
                  <div className="text-xs text-muted-foreground">Loading…</div>
                ) : !repoPats || repoPats.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    No Repo PATs yet.{" "}
                    <Link
                      href="/admin#repo-pats"
                      className="underline"
                      data-testid={`link-git-repos-repo-pats-empty-${projectName}`}
                    >
                      Add one in Source control → Repos PAT
                    </Link>
                    .
                  </div>
                ) : (
                  <Select
                    value={repoPatId}
                    onValueChange={(v) => setRepoPatId(v)}
                  >
                    <SelectTrigger
                      id={`git-repo-pat-${projectName}`}
                      data-testid={`select-git-repos-repo-pat-${projectName}`}
                    >
                      <SelectValue placeholder="Select a Repo PAT" />
                    </SelectTrigger>
                    <SelectContent>
                      {repoPats.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {PROVIDER_LABEL[p.provider as Provider] ?? p.provider}{" "}
                          - {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div>
              <Label htmlFor={`git-url-${projectName}`}>Repository URL</Label>
              <Input
                id={`git-url-${projectName}`}
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder={
                  providerMode === "existing_pat"
                    ? PROVIDER_PLACEHOLDER.azure_repos
                    : PROVIDER_PLACEHOLDER[providerMode]
                }
                data-testid={`input-git-repos-url-${projectName}`}
              />
            </div>
            <div>
              <Label htmlFor={`git-branch-${projectName}`}>Branch</Label>
              <Input
                id={`git-branch-${projectName}`}
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                data-testid={`input-git-repos-branch-${projectName}`}
              />
            </div>
            {providerMode !== "existing_pat" && (
              <div>
                <Label htmlFor={`git-pat-${projectName}`}>
                  Personal Access Token
                </Label>
                {data?.patSetAt && !replacePat ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 text-sm text-muted-foreground font-mono">
                      •••{data.patLastFour} (set{" "}
                      {new Date(data.patSetAt).toLocaleDateString()})
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setReplacePat(true)}
                      data-testid={`button-git-repos-replace-pat-${projectName}`}
                    >
                      Replace
                    </Button>
                  </div>
                ) : (
                  <Input
                    id={`git-pat-${projectName}`}
                    type="password"
                    value={pat}
                    onChange={(e) => setPat(e.target.value)}
                    autoComplete="off"
                    data-testid={`input-git-repos-pat-${projectName}`}
                  />
                )}
              </div>
            )}
          </div>
          <div className="pt-2">
            <MyForkSection projectName={projectName} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={save.isPending}
              data-testid={`button-git-repos-save-${projectName}`}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pushOpen}
        onOpenChange={(o) => {
          if (!o) {
            setPushOpen(false);
            setCommitMessage("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Push to {providerLabel}?</DialogTitle>
            <DialogDescription>
              Commit the current contents of{" "}
              <span className="font-mono">{projectName}</span> and push them
              to branch <span className="font-mono">{data?.branch}</span>{" "}
              using the stored Personal Access Token.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`git-commit-message-${projectName}`}>
              Commit message
            </Label>
            <Textarea
              id={`git-commit-message-${projectName}`}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Describe what changed"
              rows={3}
              data-testid={`input-git-repos-commit-message-${projectName}`}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPushOpen(false);
                setCommitMessage("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                push.mutate({
                  projectName,
                  data: { commitMessage: commitMessage.trim() },
                })
              }
              disabled={push.isPending || !commitMessage.trim()}
              data-testid={`button-git-repos-confirm-push-${projectName}`}
            >
              {push.isPending && (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              )}
              Commit and push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmPull}
        onOpenChange={(o) => !o && setConfirmPull(false)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pull from {providerLabel}?</DialogTitle>
            <DialogDescription>
              This will overwrite the contents of{" "}
              <span className="font-mono">{projectName}</span> with a fresh
              clone of branch{" "}
              <span className="font-mono">{data?.branch}</span>. The current
              contents are kept as a single backup directory you can rename
              back to roll over.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmPull(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => pull.mutate({ projectName })}
              disabled={pull.isPending}
              data-testid={`button-git-repos-confirm-pull-${projectName}`}
            >
              {pull.isPending && (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              )}
              Pull and overwrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export function GitReposSection() {
  const { data: projects, isLoading } = useListAvailableProjects({
    query: { queryKey: ["listAvailableProjects"] },
  });

  if (isLoading) {
    return (
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    );
  }
  if (!projects || projects.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground">
        No projects in the workspace yet.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {projects.map((p) => (
        <ProjectRow key={p.solutionName} projectName={p.solutionName} />
      ))}
    </ul>
  );
}

// Back-compat alias — older imports referenced AzureReposSection.
export const AzureReposSection = GitReposSection;

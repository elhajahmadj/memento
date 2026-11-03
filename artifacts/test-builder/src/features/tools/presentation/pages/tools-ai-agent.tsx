import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import {
  useGetAiAgentOrgConfig,
  usePutAiAgentOrgConfig,
  useListAvailableProjects,
  useListAiAgentKeys,
  getGetAiAgentOrgConfigQueryKey,
  getListAvailableProjectsQueryKey,
  getListAiAgentKeysQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { useIsAdmin } from "@/features/auth/presentation/role";
import {
  SwitchOrgGatePage,
  useSwitchOrgGate,
} from "@/features/auth/presentation/switch-org-gate";
import { AiAgentKeysSection } from "./ai-agent-keys-section";
import { ApiKeyStatusSection } from "./ai-agent/api-key-status-section";
import { CatalogTab } from "./ai-agent/catalog-tab";
import { ProjectRow } from "./ai-agent/project-row";

export function ToolsAiAgent() {
  const isAdmin = useIsAdmin();
  const { canPromptSwitch } = useSwitchOrgGate({
    allowed: isAdmin,
    requires: "admin",
    pageLabel: "AI Agent",
    toastMessage: "You don't have access to Tools",
  });
  const qc = useQueryClient();

  const orgKey = getGetAiAgentOrgConfigQueryKey();
  const { data: orgCfg, isLoading: orgLoading } = useGetAiAgentOrgConfig({
    query: { queryKey: orgKey, enabled: isAdmin },
  });
  const putOrg = usePutAiAgentOrgConfig({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: orgKey });
        toast.success("AI agent settings saved");
      },
      onError: (e: unknown) =>
        toast.error(`Save failed: ${(e as Error).message ?? ""}`),
    },
  });
  const { data: projects } = useListAvailableProjects({
    query: {
      queryKey: getListAvailableProjectsQueryKey(),
      enabled: isAdmin,
    },
  });
  const { data: keysData, isLoading: keysLoading } = useListAiAgentKeys({
    query: {
      queryKey: getListAiAgentKeysQueryKey(),
      enabled: isAdmin,
    },
  });
  const aiKeys = useMemo(() => keysData?.keys ?? [], [keysData]);

  const [enabled, setEnabled] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>("");

  useEffect(() => {
    if (orgCfg) {
      setEnabled(orgCfg.enabled);
    }
  }, [orgCfg]);

  const sortedProjects = useMemo(
    () =>
      [...(projects ?? [])]
        .filter((p) => !p.disabled)
        .map((p) => p.solutionName)
        .sort((a, b) => a.localeCompare(b)),
    [projects],
  );

  useEffect(() => {
    if (!selectedProject && sortedProjects.length > 0) {
      setSelectedProject(sortedProjects[0]);
    }
  }, [sortedProjects, selectedProject]);

  if (!isAdmin) {
    if (!canPromptSwitch) return null;
    return (
      <SwitchOrgGatePage
        pageLabel="AI Agent"
        description="Configure the AI test-authoring agent for this organization."
        requires="admin"
        testId="ai-agent-switch-org-prompt"
        contentClassName="max-w-4xl"
        backTestId="button-ai-agent-back"
        backTo="/tools"
        backLabel="Back to Tools"
      />
    );
  }

  return (
    <PageShell
      contentClassName="max-w-4xl"
      backTestId="button-ai-agent-back"
      backTo="/tools"
      backLabel="Back to Tools"
    >
      <div className="mb-6">
        <h1 className="text-3xl font-semibold mb-1 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" /> AI Agent
        </h1>
        <p className="text-muted-foreground">
          Configure the AI test-authoring agent for this organization. Once
          enabled and at least one API key is saved, admins can opt
          individual projects in and let users author tests from
          plain-English plans.
        </p>
      </div>

      <Card className="mb-4">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Enable for organization</Label>
              <p className="text-sm text-muted-foreground">
                Master switch. Per-project switches below have no effect when
                this is off.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => {
                setEnabled(v);
                putOrg.mutate({ data: { enabled: v } });
              }}
              disabled={orgLoading || putOrg.isPending}
              data-testid="switch-ai-org-enabled"
            />
          </div>
        </CardContent>
      </Card>

      <Card id="keys" className="mb-4 scroll-mt-24">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-lg font-semibold">API Keys</h2>
          <AiAgentKeysSection />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-3">Per-project</h2>
          {sortedProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No projects available.
            </p>
          ) : (
            <div className="grid gap-2">
              {sortedProjects.map((name) => (
                <ProjectRow
                  key={name}
                  projectName={name}
                  keys={aiKeys}
                  keysLoading={keysLoading}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-3">Project catalog</h2>
          <p className="text-sm text-muted-foreground mb-3">
            Hints the agent uses when interpreting plans: reusable methods,
            stable selectors, and category labels for emitted tests.
          </p>
          <div className="max-w-sm">
            <Label>Project</Label>
            <Select value={selectedProject} onValueChange={setSelectedProject}>
              <SelectTrigger data-testid="select-ai-catalog-project">
                <SelectValue placeholder="Pick a project" />
              </SelectTrigger>
              <SelectContent>
                {sortedProjects.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedProject ? (
            <CatalogTab projectName={selectedProject} />
          ) : null}
        </CardContent>
      </Card>

      <ApiKeyStatusSection />
    </PageShell>
  );
}

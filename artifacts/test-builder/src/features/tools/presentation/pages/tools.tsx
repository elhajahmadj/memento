import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  FlaskConical,
  HardDrive,
  ListChecks,
  Sparkles,
  Activity,
  Wrench,
} from "lucide-react";
import {
  listValidationRuns,
  useGetCurrentProject,
  useListInternalTestSuites,
  getListInternalTestSuitesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/shared/ui/card";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { useIsAdmin, useIsAnyAdmin } from "@/features/auth/presentation/role";
import { GenerateDocPageDialog } from "@/features/tools/presentation/components/generate-doc-page-dialog";
import { summarizeByTest } from "@/features/tools/domain/validation-run-rules";
import {
  SwitchOrgGatePage,
  useSwitchOrgGate,
} from "@/features/auth/presentation/switch-org-gate";

export function Tools() {
  const isAnyAdmin = useIsAnyAdmin();
  const isAdmin = useIsAdmin();
  const { canPromptSwitch } = useSwitchOrgGate({
    allowed: isAnyAdmin,
    requires: "anyAdmin",
    pageLabel: "Tools",
  });
  // Only fetch the runner capability for full admins (the only role that
  // would see the card anyway). When disabled — typically because the
  // production bundle ships without the source tree — hide the entry
  // entirely instead of dead-ending the user on a "feature unavailable"
  // page.
  const internalTestsCapKey = getListInternalTestSuitesQueryKey();
  const { data: internalTestsCap } = useListInternalTestSuites({
    query: { queryKey: internalTestsCapKey, enabled: isAdmin },
  });
  const internalTestsEnabled = internalTestsCap?.enabled ?? false;
  const [, navigate] = useLocation();
  const [docOpen, setDocOpen] = useState(false);
  const { data: currentProject } = useGetCurrentProject();
  // Pull the validation runs only when the dialog might actually be
  // exercised: a known-admin viewer with a loaded project. The doc
  // dialog needs the per-test names to feed the AI; we derive them
  // from the same source as the Test Runs page.
  const projectLoaded =
    !!currentProject?.project?.solutionName && currentProject.project.solutionName.length > 0;
  const { data: runs } = useQuery({
    queryKey: ["validation-runs", "tools-doc"],
    queryFn: listValidationRuns,
    enabled: isAnyAdmin && projectLoaded,
    refetchInterval: false,
  });
  const docTestNames = useMemo(() => {
    if (!runs) return [];
    const groups = summarizeByTest(runs);
    return Array.from(
      new Set(
        groups
          .map(
            (g) =>
              g.methodName ?? (g.filePath.split("/").pop() ?? g.filePath),
          )
          .filter((s): s is string => !!s && s !== "(unknown)"),
      ),
    );
  }, [runs]);

  if (!isAnyAdmin) {
    if (!canPromptSwitch) return null;
    return (
      <SwitchOrgGatePage
        pageLabel="Tools"
        description="Admin-only utilities for managing the workspace."
        requires="anyAdmin"
        testId="tools-switch-org-prompt"
        contentClassName="max-w-4xl"
        backTestId="button-tools-back"
      />
    );
  }

  return (
    <PageShell contentClassName="max-w-4xl" backTestId="button-tools-back">
      <h1 className="text-3xl font-semibold mb-2">Tools</h1>
      <p className="text-muted-foreground mb-8">
        {isAdmin
          ? "Admin-only utilities for managing the workspace."
          : "Tools for projects you've been assigned to."}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          onClick={() => navigate("/tools/test-runs")}
          className="cursor-pointer hover-elevate active-elevate-2 transition-all border-card-border"
          data-testid="card-tool-test-runs"
        >
          <CardContent className="p-6 flex items-start gap-4">
            <div className="h-11 w-11 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <ListChecks className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Test runs</h2>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                Browse the validation run history for this project, spot
                flaky tests via per-recording sparklines, and download
                Playwright traces.
              </p>
            </div>
          </CardContent>
        </Card>
        {isAdmin && (
          <Card
            onClick={() => navigate("/tools/validation-traces")}
            className="cursor-pointer hover-elevate active-elevate-2 transition-all border-card-border"
            data-testid="card-tool-validation-traces"
          >
            <CardContent className="p-6 flex items-start gap-4">
              <div className="h-11 w-11 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <HardDrive className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Validation traces</h2>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                  See how much disk the validation trace zips and screenshots
                  are using and when the last cleanup sweep ran.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {isAdmin && internalTestsEnabled && (
          <Card
            onClick={() => navigate("/tools/internal-tests")}
            className="cursor-pointer hover-elevate active-elevate-2 transition-all border-card-border"
            data-testid="card-tool-internal-tests"
          >
            <CardContent className="p-6 flex items-start gap-4">
              <div className="h-11 w-11 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <FlaskConical className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Internal tests</h2>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                  Run the api-server vitest suites with live log streaming and
                  pass/fail summary.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        <Card
          onClick={() => navigate("/tools/activity")}
          className="cursor-pointer hover-elevate active-elevate-2 transition-all border-card-border"
          data-testid="card-tool-activity"
        >
          <CardContent className="p-6 flex items-start gap-4">
            <div className="h-11 w-11 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <Activity className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Activity</h2>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                Single timeline of who changed what file on which project.
              </p>
            </div>
          </CardContent>
        </Card>
        {isAdmin && (
          <Card
            onClick={() => navigate("/tools/maintenance")}
            className="cursor-pointer hover-elevate active-elevate-2 transition-all border-card-border"
            data-testid="card-tool-maintenance"
          >
            <CardContent className="p-6 flex items-start gap-4">
              <div className="h-11 w-11 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <Wrench className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Maintenance</h2>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                  Tidy up files generated by the recorder in the active
                  project.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {isAdmin && (
          <Card
            onClick={() => projectLoaded && setDocOpen(true)}
            className={
              "transition-all border-card-border " +
              (projectLoaded
                ? "cursor-pointer hover-elevate active-elevate-2"
                : "opacity-60 cursor-not-allowed")
            }
            title={
              projectLoaded
                ? "Generate a plain-English doc page for the loaded project (AI)"
                : "Load a project first."
            }
            data-testid="card-tool-generate-doc-page"
          >
            <CardContent className="p-6 flex items-start gap-4">
              <div className="h-11 w-11 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">
                    Generate doc page (AI)
                  </h2>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                  Draft a one-page "What this app does and what we test"
                  doc for the loaded project, ready to paste into your
                  team's wiki.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {isAdmin && (
          <Card
            onClick={() => navigate("/tools/ai-agent")}
            className="cursor-pointer hover-elevate active-elevate-2 transition-all border-card-border"
            data-testid="card-tool-ai-agent"
          >
            <CardContent className="p-6 flex items-start gap-4">
              <div className="h-11 w-11 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">AI Agent</h2>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                  Enable the AI test-authoring agent, configure the provider
                  API key, opt projects in, and curate the per-project hint
                  catalog.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      <GenerateDocPageDialog
        open={docOpen}
        onOpenChange={setDocOpen}
        projectName={currentProject?.project?.solutionName ?? ""}
        testNames={docTestNames}
      />
    </PageShell>
  );
}

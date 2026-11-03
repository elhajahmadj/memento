import { FilePlus2, FolderOpen, Loader2 } from "lucide-react";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { NewProjectDialog } from "./new-project-dialog";
import { ForkProjectsList } from "./fork-projects-list";
import { SubmitForkDialog } from "./submit-fork-dialog";
import { DemoCard } from "./demo-card";
import { OnboardingTour } from "@/features/onboarding/presentation/onboarding-tour";
import { useLimitedProjectsHome } from "../hooks/use-limited-projects-home";

export function LimitedHome() {
  const {
    isLoading,
    items,
    byProject,
    latestByProject,
    expanded,
    toggleExpanded,
    load,
    requestMutation,
    submitTarget,
    setSubmitTarget,
    submitComment,
    setSubmitComment,
    submitMutation,
    newOpen,
    setNewOpen,
    create,
    myPending,
    approvedDirect,
    cancel,
  } = useLimitedProjectsHome();

  return (
    <PageShell
      contentClassName="max-w-3xl w-full"
      mainClassName="flex-1 p-8"
      showBack={false}
    >
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold mb-2">Projects</h1>
          <p className="text-muted-foreground">
            Open one of your forks, or request a fork of a project an admin has set up.
          </p>
        </div>
        <Button
          onClick={() => setNewOpen(true)}
          data-testid="button-request-new-project"
        >
          <FilePlus2 className="h-4 w-4 mr-2" /> Request new project
        </Button>
      </div>
      <DemoCard className="mb-6" />

      {approvedDirect.length > 0 && (
        <section className="mb-6" data-testid="section-my-approved-projects">
          <h2 className="text-sm font-medium mb-2 text-muted-foreground">
            Your approved projects
          </h2>
          <ul className="space-y-2">
            {approvedDirect.map((p) => (
              <li
                key={p.solutionName}
                className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3"
                data-testid={`row-my-approved-${p.solutionName}`}
              >
                <div className="font-medium truncate">{p.solutionName}</div>
                <Button
                  size="sm"
                  data-testid={`button-open-approved-${p.solutionName}`}
                  onClick={() =>
                    load.mutate({ data: { slnPath: p.slnPath } })
                  }
                  disabled={load.isPending}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {myPending.length > 0 && (
        <section className="mb-6" data-testid="section-my-pending-projects">
          <h2 className="text-sm font-medium mb-2 text-muted-foreground">
            Your pending project requests
          </h2>
          <ul className="space-y-2">
            {myPending.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-md border border-dashed border-border bg-card/60 px-4 py-3"
                data-testid={`row-my-pending-${r.projectName}`}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.projectName}</div>
                  <div className="text-xs text-muted-foreground">
                    Awaiting admin approval ·{" "}
                    {new Date(r.requestedAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`button-cancel-pending-${r.projectName}`}
                  onClick={() => cancel.mutate({ id: r.id })}
                  disabled={cancel.isPending}
                >
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <Card className="border-card-border border-dashed ambient-bg-soft">
          <CardContent className="p-12 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-brand-gradient-soft border border-primary/20 flex items-center justify-center mb-4 shadow-sm">
              <FolderOpen className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-1" data-testid="text-no-projects">
              No projects
            </h2>
            <p className="text-sm text-muted-foreground">
              No projects are available yet. Ask an admin to scaffold one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ForkProjectsList
          items={items}
          byProject={byProject}
          latestByProject={latestByProject}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
          onSubmit={(forkId, projectName) => {
            setSubmitComment("");
            setSubmitTarget({ forkId, projectName });
          }}
          submitDisabled={submitMutation.isPending}
          onOpen={(forkPath, projectName) =>
            load.mutate({ data: { slnPath: `${forkPath}/${projectName}.sln` } })
          }
          openDisabled={load.isPending}
          onRequest={(projectName) => requestMutation.mutate(projectName)}
          requestDisabled={requestMutation.isPending}
        />
      )}

      <NewProjectDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreate={(input) => create.mutate({ data: input })}
        creating={create.isPending}
      />

      <OnboardingTour />

      <SubmitForkDialog
        projectName={submitTarget?.projectName ?? null}
        comment={submitComment}
        onCommentChange={setSubmitComment}
        onCancel={() => {
          setSubmitTarget(null);
          setSubmitComment("");
        }}
        onSubmit={() =>
          submitTarget &&
          submitMutation.mutate({ forkId: submitTarget.forkId, comment: submitComment })
        }
        pending={submitMutation.isPending}
      />
    </PageShell>
  );
}

import { Download, FilePlus2, FolderOpen, Loader2 } from "lucide-react";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { NewProjectDialog } from "./new-project-dialog";
import { LanguageBadge } from "./language-badge";
import { useGuestProjectsHome } from "../hooks/use-guest-projects-home";
import {
  exportButtonLabel,
  useExportProject,
} from "../hooks/use-export-project";

/**
 * Projects home for a guest ("Continue as guest") trial identity.
 *
 * Guests own exactly one project and have no forks, approvals, or
 * access requests — so this is a deliberately separate page rather than
 * a branch inside `LimitedHome`, whose every data source is closed to
 * them server-side. The countdown and the "sign in to keep your work"
 * prompt live in the shared `GuestBanner` at the top of `PageShell`.
 */
export function GuestHome() {
  const {
    isLoading,
    project,
    hasProject,
    newOpen,
    setNewOpen,
    create,
    load,
  } = useGuestProjectsHome();
  const { exportProject, isExporting } = useExportProject();

  return (
    <PageShell
      contentClassName="max-w-3xl w-full"
      mainClassName="flex-1 p-8"
      showBack={false}
    >
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold mb-2">Your project</h1>
          <p className="text-muted-foreground">
            Guest sessions include one project. Record a UI, API, or
            performance suite and export it before your session ends.
          </p>
        </div>
        {!hasProject && !isLoading && (
          <Button
            onClick={() => setNewOpen(true)}
            data-testid="button-guest-create-project"
          >
            <FilePlus2 className="h-4 w-4 mr-2" /> Create your project
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !project ? (
        <Card className="border-card-border border-dashed ambient-bg-soft">
          <CardContent className="p-12 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-brand-gradient-soft border border-primary/20 flex items-center justify-center mb-4 shadow-sm">
              <FolderOpen className="h-6 w-6 text-primary" />
            </div>
            <h2
              className="text-lg font-semibold mb-1"
              data-testid="text-guest-no-project"
            >
              No project yet
            </h2>
            <p className="text-sm text-muted-foreground">
              Create one to start recording. You can pick UI, API, or
              performance, in any of the four supported languages.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card
          className="border-card-border"
          data-testid={`card-guest-project-${project.solutionName}`}
        >
          <CardContent className="p-5 flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="font-medium truncate flex items-center gap-2">
                {project.solutionName}
                <LanguageBadge language={project.language} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Deleted when your guest session ends — export it to keep
                a copy.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isExporting}
                onClick={() =>
                  void exportProject({
                    solutionName: project.solutionName,
                    language: project.language,
                    slnPath: project.slnPath,
                  })
                }
                data-testid="button-guest-export"
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {exportButtonLabel(project.language)}
              </Button>
              <Button
                size="sm"
                disabled={load.isPending}
                onClick={() =>
                  load.mutate({ data: { slnPath: project.slnPath } })
                }
                data-testid="button-guest-open"
              >
                Open
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <NewProjectDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreate={(input) => create.mutate({ data: input })}
        creating={create.isPending}
      />
    </PageShell>
  );
}

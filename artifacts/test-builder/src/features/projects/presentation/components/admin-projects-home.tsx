import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CROSS_FADE, SPRING } from "@/shared/motion/springs";
import { FilePlus2, FolderOpen, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { useIsAdmin } from "@/features/auth/presentation/role";
import { OnboardingTour } from "@/features/onboarding/presentation/onboarding-tour";
import { NewProjectDialog } from "./new-project-dialog";
import { BuildWithAiProjectsDialog } from "./build-with-ai-projects-dialog";
import { SuggestTestsDialog } from "./suggest-tests-dialog";
import { AvailableProjectsList } from "./available-projects-list";
import { DemoCard } from "./demo-card";
import { useAdminProjectsHome } from "../hooks/use-admin-projects-home";

export function AdminProjectsHome() {
  const isAdmin = useIsAdmin();
  const {
    newOpen,
    setNewOpen,
    aiOpen,
    setAiOpen,
    aiDisabledReason,
    loadingAvailable,
    visibleAvailable,
    hasProjects,
    create,
    clone,
    cloneError,
    clearCloneError,
    load,
    requestAccess,
    myPendingByProject,
    cancel,
  } = useAdminProjectsHome();
  const [suggestOpen, setSuggestOpen] = useState(false);

  // Framer Motion writes inline styles, so the `prefers-reduced-motion`
  // block in index.css can't reach these — the preference has to be read
  // in JS. Reduced motion keeps the fade (it aids comprehension) and
  // drops the upward travel.
  const reduceMotion = useReducedMotion();
  const enter = reduceMotion
    ? { initial: { opacity: 0 }, transition: CROSS_FADE }
    : { initial: { opacity: 0, y: 8 }, transition: SPRING.move };

  return (
    <PageShell
      contentClassName="max-w-5xl w-full"
      mainClassName="flex-1 p-8"
      showBack={false}
    >
      <motion.div
        initial={enter.initial}
        animate={{ opacity: 1, y: 0 }}
        transition={enter.transition}
        className="flex items-start justify-between gap-4 mb-8 flex-wrap"
      >
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Open an existing solution or scaffold a new one.
          </p>
        </div>
        {hasProjects && (
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button
                variant="outline"
                onClick={() => setSuggestOpen(true)}
                data-testid="button-suggest-tests"
              >
                <Sparkles className="h-4 w-4 mr-2" /> Suggest tests
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="outline"
                onClick={() => setAiOpen(true)}
                disabled={!!aiDisabledReason}
                title={aiDisabledReason}
                data-testid="button-build-with-ai"
              >
                <Sparkles className="h-4 w-4 mr-2" /> Build with AI
              </Button>
            )}
            <Button onClick={() => setNewOpen(true)} data-testid="button-new-project">
              <FilePlus2 className="h-4 w-4 mr-2" /> {isAdmin ? "New Project" : "Request new project"}
            </Button>
          </div>
        )}
      </motion.div>

      <DemoCard className="mb-6" />

      {loadingAvailable ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !hasProjects ? (
        <motion.div
          initial={enter.initial}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...enter.transition, delay: 0.05 }}
        >
          <Card className="border-card-border border-dashed ambient-bg-soft">
            <CardContent className="p-12 text-center">
              <div className="mx-auto w-14 h-14 rounded-full bg-brand-gradient-soft border border-primary/20 flex items-center justify-center mb-4 shadow-sm">
                <FolderOpen className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-lg font-semibold mb-1" data-testid="text-no-projects">
                No projects
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                {isAdmin
                  ? "You haven't scaffolded any solutions yet."
                  : "There aren't any solutions in the workspace yet. An admin can create one."}
              </p>
              <div className="flex items-center justify-center gap-2">
                {isAdmin && (
                  <Button
                    variant="outline"
                    onClick={() => setAiOpen(true)}
                    disabled={!!aiDisabledReason}
                    title={aiDisabledReason}
                    data-testid="button-build-with-ai-empty"
                  >
                    <Sparkles className="h-4 w-4 mr-2" /> Build with AI
                  </Button>
                )}
                <Button onClick={() => setNewOpen(true)} data-testid="button-add-project-empty">
                  <FilePlus2 className="h-4 w-4 mr-2" /> {isAdmin ? "Add Project" : "Request project"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <AvailableProjectsList
          projects={visibleAvailable}
          isAdmin={isAdmin}
          onLoad={(slnPath) => load.mutate({ data: { slnPath } })}
          loadDisabled={load.isPending}
          onRequestAccess={(projectName) => requestAccess.mutate({ data: { projectName } })}
          requestPending={requestAccess.isPending}
          pendingApprovalRequestIdByProject={myPendingByProject}
          onCancelPendingApproval={(id) => cancel.mutate({ id })}
          cancelPending={cancel.isPending}
        />
      )}

      <NewProjectDialog
        open={newOpen}
        onOpenChange={(next) => {
          setNewOpen(next);
          if (!next) clearCloneError();
        }}
        creating={create.isPending}
        onCreate={(input) => create.mutate({ data: input })}
        cloning={clone.isPending}
        onClone={
          isAdmin
            ? (input) => {
                clearCloneError();
                clone.mutate({ data: input });
              }
            : undefined
        }
        cloneError={cloneError}
        onClearCloneError={clearCloneError}
      />

      <BuildWithAiProjectsDialog open={aiOpen} onOpenChange={setAiOpen} />

      <SuggestTestsDialog open={suggestOpen} onOpenChange={setSuggestOpen} />

      <OnboardingTour />
    </PageShell>
  );
}

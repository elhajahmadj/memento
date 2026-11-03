import { useState } from "react";
import { JmxRecordingControls } from "./toolbar/jmx-recording-controls";
import { Logo } from "@/shared/ui/shell/logo";
import { UserMenu } from "@/features/auth/presentation/user-menu";
import { useQuery } from "@tanstack/react-query";
import {
  listMyApprovals,
  type ApprovalDto,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { ArrowLeft, Home } from "lucide-react";
import { GeneratePipelineFileDialog } from "@/features/workbench/presentation/dialogs/generate-pipeline-file-dialog";
import { OpenBrowserDialog } from "@/features/workbench/presentation/dialogs/open-browser-dialog";
import { WorkbenchActionsMenu } from "@/features/workbench/presentation/components/workbench-actions-menu";
import { useIsAnyAdmin as useIsAdmin, useIsGuest } from "@/features/auth/presentation/role";
import { HelpMenu } from "@/features/workbench/presentation/components/help-menu";
import { useExportProject } from "@/features/projects/presentation/hooks/use-export-project";
import { AiTestButton } from "./toolbar/ai-test-button";
import { OpenInVscodeButton } from "./toolbar/open-in-vscode-button";
import { OtherOwnerBanner } from "./toolbar/other-owner-banner";
import { RecordingTargetLabel } from "./toolbar/recording-target-label";
import { OpenBrowserPreAttachControls } from "./toolbar/open-browser-pre-attach-controls";
import { StopRecordingButton } from "./toolbar/stop-recording-button";
import { StoppedStateControls } from "./toolbar/stopped-state-controls";
import { StartOrBuildButton } from "./toolbar/start-or-build-button";
import {
  MethodCollisionDialog,
  type MethodCollision,
} from "./toolbar/method-collision-dialog";
import { ConfirmDiscardKeepOpenDialog } from "./toolbar/confirm-discard-keep-open-dialog";
import { useRecordingMutations } from "./toolbar/use-recording-mutations";

export function Toolbar({
  project,
  recording,
  stopped,
  openBrowserPreAttach = false,
  status,
  onStart,
  onValidate,
  onAttachToOpenBrowser,
  onHome,
  jmxSessionId,
  jmxIsCapturing,
  jmxCapturedVisible,
  jmxRecordedVisible,
  onToggleJmxCaptured,
  onToggleJmxRecorded,
  onOpenAiAuthor,
}: {
  project: {
    solutionName: string;
    namespace: string;
    rootPath: string;
    slnPath: string;
    language?: "csharp" | "python" | "nodejs" | "java" | "jmx" | undefined;
    solutionType?: "playwright" | "api" | undefined;
    // JMX-only: see Project type in api-server domain for semantics.
    jmxFiles?: string[] | undefined;
    jmxEmbedCredentials?: boolean | undefined;
    targetUrl?: string | null | undefined;
  };
  recording: boolean;
  stopped: boolean;
  // True while a `/recording/open-browser` session is live and has
  // NOT yet been promoted to a real recording via
  // `/recording/attach-to-open-browser`. Detected by the workbench
  // page from the recording-status poll so it survives page reloads.
  openBrowserPreAttach?: boolean | undefined;
  status?: {
    target?: string | null | undefined;
    targetClass?: string | null | undefined;
    methodName?: string | null | undefined;
    ownerUserId?: string | null | undefined;
    ownerUsername?: string | null | undefined;
    ownerProjectName?: string | null | undefined;
    isOwnedByOther?: boolean | undefined;
    keepBrowserOpen?: boolean | undefined;
  } | undefined;
  onStart: () => void;
  onValidate: () => void;
  onStop: () => Promise<void>;
  // Open the Start Recording dialog in "attach to open browser" mode.
  onAttachToOpenBrowser?: (() => void) | undefined;
  onHome: () => void;
  // Server-authoritative JMX session id from the workbench's status
  // poll. Passed into <JmxRecordingControls /> so Stop always targets
  // the live server session even if the local mutation cache went
  // stale (page reload, prior error, etc.).
  jmxSessionId?: string | null | undefined;
  // Server-authoritative flag from the status poll. False while the
  // JMX session is in preview-only mode (browser open, no capture);
  // true once CDP capture has been armed.
  jmxIsCapturing?: boolean | undefined;
  // JMX-only: visibility state for the captured/recorded side panels
  // and the toggles that flip them. Forwarded into the Actions menu
  // so users can hide either panel to give the browser more room.
  jmxCapturedVisible?: boolean | undefined;
  jmxRecordedVisible?: boolean | undefined;
  onToggleJmxCaptured?: (() => void) | undefined;
  onToggleJmxRecorded?: (() => void) | undefined;
  /** Open the plain-English step/assertion authoring dialog. */
  onOpenAiAuthor?: ((mode: "step" | "assertion") => void) | undefined;
}) {
  const isAdmin = useIsAdmin();
  const isGuest = useIsGuest();
  // Guests save directly like admins (see StoppedStateControls). The
  // approval poll below is skipped for both — it's 403 for guests.
  const canSaveDirectly = isAdmin || isGuest;
  const myApprovals = useQuery<ApprovalDto[]>({
    queryKey: ["myApprovals"],
    queryFn: () => listMyApprovals(),
    enabled: !canSaveDirectly,
    refetchInterval: 5000,
  });
  const pendingForProject = !canSaveDirectly
    ? (myApprovals.data ?? []).find(
        (a) =>
          a.projectName === project.solutionName && a.status === "pending",
      ) ?? null
    : null;
  const [collision, setCollision] = useState<MethodCollision | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Confirmation dialog for discarding while a kept-open browser is alive.
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const keepBrowserOpenActive = status?.keepBrowserOpen === true;

  // JMX projects swap in <JmxRecordingControls />; see that component.
  const isJmx = project.language === "jmx";
  const { stop, finalize, forceDiscard, cancelOpenBrowser, discardSession } =
    useRecordingMutations({
      onCollision: (c, seed) => {
        setCollision(c);
        setRenameValue(seed);
      },
      onCleared: () => setCollision(null),
    });

  const otherOwnerActive =
    isAdmin &&
    !!status?.isOwnedByOther &&
    !!status?.ownerUserId &&
    !recording &&
    !stopped;

  const { exportProject, isExporting } = useExportProject();
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);
  const [openBrowserDialogOpen, setOpenBrowserDialogOpen] = useState(false);
  const isApi = project.solutionType === "api";
  // Reasons the open-browser-related affordances may be disabled. We
  // surface them as tooltips so the user can tell why a button is
  // greyed out.
  const openBrowserMenuDisabledReason =
    recording || stopped || openBrowserPreAttach
      ? "Finish or close the active recording session first."
      : status?.isOwnedByOther
      ? `Another user (${status?.ownerUsername ?? "unknown"}) is recording. Wait for them to finish.`
      : undefined;
  const aiDisabledReason = openBrowserPreAttach
    ? "Close the open browser session first."
    : undefined;

  const handleDiscardStopped = async () => {
    if (keepBrowserOpenActive) {
      setConfirmDiscardOpen(true);
      return;
    }
    await discardSession();
  };

  const handleConfirmDiscardKeepOpen = async () => {
    setConfirmDiscardOpen(false);
    await discardSession();
  };

  return (
    <>
      <header className="h-12 material-chrome border-b border-border flex items-center px-4 gap-3 shadow-nav dark:shadow-none">
        <Button
          variant="ghost"
          size="sm"
          onClick={onHome}
          data-testid="button-home"
          className="gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" />
          <Home className="h-4 w-4" />
          <span>Home</span>
        </Button>
        <div className="flex items-center gap-2">
          <Logo className="text-base" />
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold text-sm">{project.solutionName}</span>
          <Badge variant="outline" className="font-mono text-xs">
            {project.namespace}
          </Badge>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {otherOwnerActive && (
            <OtherOwnerBanner
              ownerUsername={status?.ownerUsername}
              ownerProjectName={status?.ownerProjectName}
              isPending={forceDiscard.isPending}
              onForceDiscard={() => forceDiscard.mutate()}
            />
          )}
          {recording && (
            <RecordingTargetLabel
              target={status?.target}
              targetClass={status?.targetClass}
              methodName={status?.methodName}
            />
          )}
          {isJmx ? (
            <JmxRecordingControls
              projectId={encodeURIComponent(project.slnPath)}
              jmxFiles={project.jmxFiles ?? []}
              targetUrl={project.targetUrl ?? null}
              serverSessionId={jmxSessionId ?? null}
              serverIsCapturing={jmxIsCapturing ?? false}
            />
          ) : openBrowserPreAttach ? (
            <OpenBrowserPreAttachControls
              onAttach={() => onAttachToOpenBrowser?.()}
              onStartFresh={onStart}
              onClose={() => cancelOpenBrowser.mutate()}
              isClosing={cancelOpenBrowser.isPending}
            />
          ) : recording ? (
            <StopRecordingButton
              onStop={() => stop.mutate()}
              isPending={stop.isPending}
            />
          ) : stopped ? (
            <StoppedStateControls
              canSaveDirectly={canSaveDirectly}
              finalizePending={finalize.isPending}
              pendingApproval={!!pendingForProject}
              onDiscard={handleDiscardStopped}
              onSave={() => finalize.mutate({ data: { mode: "save" } })}
              onSubmitForApproval={() =>
                finalize.mutate({ data: { mode: "submit-for-approval" } })
              }
            />
          ) : (
            <StartOrBuildButton
              isApi={isApi}
              pendingApproval={!!pendingForProject}
              onStart={onStart}
            />
          )}
          {(project.language === "python" ||
            project.language === "nodejs" ||
            project.language === "java") && (
            <OpenInVscodeButton rootPath={project.rootPath} />
          )}
          {!isJmx && (
            <AiTestButton
              projectName={project.solutionName}
              projectId={encodeURIComponent(project.slnPath)}
              language={
                project.language && project.language !== "jmx"
                  ? project.language
                  : "csharp"
              }
              solutionType={project.solutionType}
              extraDisabledReason={aiDisabledReason}
            />
          )}
          <WorkbenchActionsMenu
            isApi={isApi}
            language={project.language}
            isExporting={isExporting}
            onValidate={onValidate}
            onExport={() =>
              exportProject({
                solutionName: project.solutionName,
                language: project.language,
              })
            }
            onOpenPipelineDialog={() => setPipelineDialogOpen(true)}
            onOpenBrowser={() => setOpenBrowserDialogOpen(true)}
            openBrowserDisabled={!!openBrowserMenuDisabledReason}
            openBrowserDisabledReason={openBrowserMenuDisabledReason}
            jmxEmbedCredentialsWarning={isJmx && !!project.jmxEmbedCredentials}
            jmxCapturedVisible={jmxCapturedVisible}
            jmxRecordedVisible={jmxRecordedVisible}
            onToggleJmxCaptured={
              isJmx && onToggleJmxCaptured ? onToggleJmxCaptured : undefined
            }
            onToggleJmxRecorded={
              isJmx && onToggleJmxRecorded ? onToggleJmxRecorded : undefined
            }
            onOpenAiAuthor={onOpenAiAuthor}
          />
          <HelpMenu />
          <UserMenu />
        </div>
      </header>
      <MethodCollisionDialog
        collision={collision}
        renameValue={renameValue}
        onRenameChange={setRenameValue}
        finalizePending={finalize.isPending}
        canSaveDirectly={canSaveDirectly}
        onCancel={() => setCollision(null)}
        onOverwrite={(mode) =>
          finalize.mutate({
            data: { mode, decision: { mode: "overwrite" } },
          })
        }
        onRename={(mode, methodName) =>
          finalize.mutate({
            data: { mode, decision: { mode: "rename", methodName } },
          })
        }
      />
      <GeneratePipelineFileDialog
        open={pipelineDialogOpen}
        onOpenChange={setPipelineDialogOpen}
      />
      <OpenBrowserDialog
        open={openBrowserDialogOpen}
        onOpenChange={setOpenBrowserDialogOpen}
      />
      <ConfirmDiscardKeepOpenDialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        onConfirm={handleConfirmDiscardKeepOpen}
      />
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import {
  useGetCurrentProject,
  useGetProjectTree,
  useListTestClasses,
  useGetRecordingStatus,
  useGetJmxRecordingStatus,
  getGetProjectTreeQueryKey,
  getListTestClassesQueryKey,
  getGetRecordingStatusQueryKey,
  getGetJmxRecordingStatusQueryKey,
} from "@workspace/api-client-react";
import { JmxRecordingCanvas } from "../components/jmx-recording-canvas";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/ui/resizable";
import { Footer } from "@/shared/ui/shell/footer";
import { OnboardingTour } from "@/features/onboarding/presentation/onboarding-tour";
import type { TreeNodeT } from "@/features/workbench/domain/types";
import { deriveRecordingPhase } from "@/features/workbench/domain/recordingPhase";
import { useIsGuest } from "@/features/auth/presentation/role";

import { Toolbar } from "../components/toolbar";
import { ExplorerPanel } from "../components/explorer-panel";
import { CodeViewerPanel } from "../components/code-viewer-panel";
import { RightPanel } from "../components/right-panel";
import { RecordingCanvas } from "../components/recording-canvas";
import { CollapsedPanelToggle } from "../components/collapsed-panel-toggle";
import { WorkbenchDialogs } from "../components/workbench-dialogs";
import { usePanelLayout } from "../hooks/usePanelLayout";
import { useWorkbenchDialogs } from "../hooks/useWorkbenchDialogs";

// Re-exports preserved for the e2e fixture and the workbench page test
// suite. These components used to live in this module before the Clean
// Architecture split (task #8) and are still imported from
// `pages/workbench` by `e2e-fixture.tsx`, the right-click pick-element
// e2e fixture, and the unit tests under `__tests__/`.
export { vscodeFileUrl } from "@/features/workbench/domain/types";
export { ActionsFeed } from "../components/actions-feed";
export { RecordingCanvas } from "../components/recording-canvas";
export { RightPanel } from "../components/right-panel";
export { TestBodyPreview } from "../components/test-body-preview";

export function Workbench() {
  const [, navigate] = useLocation();
  const isGuest = useIsGuest();
  const { data: current, isLoading: loadingProject } = useGetCurrentProject();
  const project = current?.project ?? null;

  useEffect(() => {
    if (!loadingProject && !project) navigate("/projects");
  }, [loadingProject, project, navigate]);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // JMX-only session state for the captured / recorded-actions side
  // panels. Both default to visible to preserve the original layout;
  // the toolbar's Actions menu flips them for the lifetime of this
  // workbench session (not persisted across reloads — see task #26).
  const [jmxCapturedVisible, setJmxCapturedVisible] = useState(true);
  const [jmxRecordedVisible, setJmxRecordedVisible] = useState(true);
  const dialogs = useWorkbenchDialogs();
  const explorer = usePanelLayout({
    collapsedKey: "workbench.explorer.collapsed",
    widthKey: "workbench.explorer.width",
    defaultWidth: 20,
    minWidth: 15,
    maxWidth: 35,
  });
  const right = usePanelLayout({
    collapsedKey: "workbench.testSuites.collapsed",
    widthKey: "workbench.testSuites.width",
    defaultWidth: 25,
    minWidth: 20,
    maxWidth: 40,
  });

  const { data: status } = useGetRecordingStatus({
    query: {
      refetchInterval: 2500,
      queryKey: getGetRecordingStatusQueryKey(),
    },
  });
  const { phase, recording, stopped, sessionLive, openBrowserPreAttach } =
    deriveRecordingPhase(status);
  void phase;

  // Close an un-attached open-browser session when the user leaves the
  // workstation. Without this the Chromium process outlived the page:
  // navigate Home and back and the browser was still sitting there,
  // holding a server-side session that blocks starting a new one.
  //
  // Deliberately limited to the PRE-ATTACH case. Once a session is
  // attached there are captured actions to lose, and silently discarding
  // someone's recording because they clicked Home would be far worse
  // than leaving a browser open — that path keeps the existing explicit
  // Stop / Discard flow.
  //
  // Read through a ref so the unmount cleanup sees the state as of
  // unmount rather than whatever it closed over on mount.
  const preAttachRef = useRef(openBrowserPreAttach);
  preAttachRef.current = openBrowserPreAttach;
  useEffect(() => {
    // `pagehide` covers tab close / hard navigation, where React never
    // runs unmount cleanups — same two-path shape as the JMX stop
    // below, including the keepalive so the request survives unload.
    const fireCancel = () => {
      if (!preAttachRef.current) return;
      preAttachRef.current = false; // idempotent across both paths
      try {
        fetch("/api/recording/cancel-open-browser", {
          method: "POST",
          credentials: "include",
          keepalive: true,
        }).catch(() => {});
      } catch {
        // best-effort cleanup
      }
    };
    window.addEventListener("pagehide", fireCancel);
    return () => {
      window.removeEventListener("pagehide", fireCancel);
      fireCancel();
    };
  }, []);

  // JMX recording status — independent of the DOM recorder's session
  // state above. Polled so the workbench can render the live canvas
  // for the user's in-flight JMX session (incl. after a page reload).
  const { data: jmxStatus } = useGetJmxRecordingStatus({
    query: {
      refetchInterval: 2500,
      enabled: project?.language === "jmx",
      queryKey: getGetJmxRecordingStatusQueryKey(),
    },
  });
  const jmxSessionId = jmxStatus?.sessionId ?? null;
  const jmxIsCapturing = jmxStatus?.isCapturing ?? false;

  // Terminate the JMX recording when the user leaves the workbench
  // (Home, another project, browser tab close, etc.). We trigger
  // cleanup from two places:
  //   1. The `useEffect([])` unmount cleanup — fires when wouter
  //      unmounts the workbench because of a route change. We can't
  //      use a `[location]` watcher here: by the time `location`
  //      changes, the workbench has already been unmounted, so a new
  //      effect inside it never runs.
  //   2. A `pagehide` listener — covers tab close / hard navigation,
  //      where React never gets a chance to run unmount cleanups.
  //      Uses `fetch(..., { keepalive: true })` so the request still
  //      leaves the browser during unload.
  // A single `firedRef` guard makes the stop request idempotent across
  // all paths: React StrictMode's dev mount/cleanup/mount cycle,
  // pagehide + unmount both firing on tab-close, and HMR-induced
  // remounts. Without it the server saw 3+ concurrent stop requests
  // racing on the same session id.
  const jmxSessionIdRef = useRef<string | null>(null);
  jmxSessionIdRef.current = jmxSessionId;
  const firedRef = useRef(false);
  useEffect(() => {
    const fireStop = () => {
      if (firedRef.current) return;
      const sid = jmxSessionIdRef.current;
      if (!sid) return;
      firedRef.current = true;
      try {
        fetch("/api/jmx/recording/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          keepalive: true,
          body: JSON.stringify({ sessionId: sid }),
        }).catch(() => {});
      } catch {
        // ignore — best-effort cleanup
      }
    };
    window.addEventListener("pagehide", fireStop);
    return () => {
      window.removeEventListener("pagehide", fireStop);
      fireStop();
    };
  }, []);

  const {
    data: tree,
    isLoading: treeLoading,
    isError: treeIsError,
    error: treeError,
    refetch: refetchTree,
  } = useGetProjectTree({
    query: { enabled: !!project, queryKey: getGetProjectTreeQueryKey() },
  });
  const {
    data: tests,
    isLoading: testsLoading,
    isError: testsIsError,
    error: testsError,
    refetch: refetchTests,
  } = useListTestClasses({
    query: { enabled: !!project, queryKey: getListTestClassesQueryKey() },
  });

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden ambient-bg-soft">
      <Toolbar
        project={project}
        recording={recording}
        stopped={stopped}
        openBrowserPreAttach={openBrowserPreAttach}
        status={status}
        jmxSessionId={jmxSessionId}
        jmxIsCapturing={jmxIsCapturing}
        jmxCapturedVisible={jmxCapturedVisible}
        jmxRecordedVisible={jmxRecordedVisible}
        onToggleJmxCaptured={() => setJmxCapturedVisible((v) => !v)}
        onToggleJmxRecorded={() => setJmxRecordedVisible((v) => !v)}
        onValidate={() => dialogs.setValidateOpen(true)}
        // Guests have no AI features; omitting the callback hides both
        // "Add step with AI" and "Add assertion with AI" via the
        // existing `onOpenAiAuthor &&` gate in the actions menu.
        onOpenAiAuthor={
          isGuest ? undefined : (mode) => dialogs.setAiAuthorMode(mode)
        }
        onStart={() =>
          project.solutionType === "api"
            ? dialogs.setBuildTestOpen(true)
            : dialogs.setStartDialogOpen(true)
        }
        onAttachToOpenBrowser={() => dialogs.setAttachDialogOpen(true)}
        onStop={async () => {
          /* handled inside RecordingCanvas */
        }}
        onHome={() => navigate("/projects")}
      />
      <div className="flex-1 min-h-0 relative">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel
            ref={explorer.ref}
            id="workbench-explorer"
            order={1}
            collapsible
            collapsedSize={0}
            defaultSize={explorer.collapsed ? 0 : explorer.defaultWidth}
            minSize={15}
            maxSize={35}
            onCollapse={explorer.onCollapse}
            onExpand={explorer.onExpand}
            onResize={explorer.onResize}
          >
            <ExplorerPanel
              projectId={encodeURIComponent(project.slnPath)}
              projectName={project.solutionName}
              tree={tree as TreeNodeT | undefined}
              selectedPath={selectedPath}
              onSelect={(n) => {
                if (n.type === "file") setSelectedPath(n.path);
              }}
              onAddFolder={(parent) => dialogs.setAddFolderUnder(parent)}
              onAddFile={(parent) => dialogs.setAddFileUnder(parent)}
              onRename={(n) => dialogs.setRenameTarget(n)}
              onDelete={(n) => dialogs.setDeleteTarget(n)}
              isLoading={treeLoading}
              isError={treeIsError}
              error={(treeError as Error | null) ?? null}
              onRetry={() => {
                void refetchTree();
              }}
              onCollapse={explorer.collapse}
              jmxFiles={
                project.language === "jmx" ? project.jmxFiles ?? [] : undefined
              }
              jmxEmbedCredentialsWarning={
                project.language === "jmx" &&
                project.jmxEmbedCredentials === true
              }
            />
          </ResizablePanel>
          <ResizableHandle
            withHandle
            {...(explorer.collapsed ? { className: "hidden" } : {})}
          />
          <ResizablePanel
            id="workbench-center"
            order={2}
            defaultSize={
              100 -
              (explorer.collapsed ? 0 : explorer.defaultWidth) -
              (right.collapsed ? 0 : right.defaultWidth)
            }
            minSize={35}
          >
            {jmxSessionId ? (
              <JmxRecordingCanvas
                sessionId={jmxSessionId}
                isCapturing={jmxIsCapturing}
                capturedVisible={jmxCapturedVisible}
              />
            ) : sessionLive ? (
              <RecordingCanvas
                recording={recording}
                capturing={recording && !openBrowserPreAttach}
              />
            ) : (
              <CodeViewerPanel selectedPath={selectedPath} />
            )}
          </ResizablePanel>
          {!(project.language === "jmx" && !jmxRecordedVisible) && (
            <>
              <ResizableHandle
                withHandle
                {...(right.collapsed ? { className: "hidden" } : {})}
              />
              <ResizablePanel
                ref={right.ref}
                id="workbench-right"
                order={3}
                collapsible
                collapsedSize={0}
                defaultSize={right.collapsed ? 0 : right.defaultWidth}
                minSize={20}
                maxSize={40}
                onCollapse={right.onCollapse}
                onExpand={right.onExpand}
                onResize={right.onResize}
              >
                <RightPanel
                  tests={tests ?? []}
                  testsLoading={testsLoading}
                  testsError={
                    testsIsError
                      ? ((testsError as Error | null) ?? null)
                      : null
                  }
                  onRetryTests={() => {
                    void refetchTests();
                  }}
                  onAddClass={() => dialogs.setAddClassOpen(true)}
                  onAddMethod={(filePath) =>
                    dialogs.setAddMethodFor(filePath)
                  }
                  onValidateClass={(filePath) => {
                    dialogs.setValidateOpen(true);
                    window.dispatchEvent(
                      new CustomEvent("validation:trigger-class", {
                        detail: { filePath },
                      }),
                    );
                  }}
                  onValidateMethod={(filePath, methodName) => {
                    dialogs.setValidateOpen(true);
                    window.dispatchEvent(
                      new CustomEvent("validation:trigger-class", {
                        detail: { filePath, methodName },
                      }),
                    );
                  }}
                  onValidateSession={() => {
                    dialogs.setValidateOpen(true);
                    window.dispatchEvent(
                      new CustomEvent("validation:trigger-session"),
                    );
                  }}
                  recording={recording}
                  stopped={stopped}
                  onCollapse={right.collapse}
                  isJmx={project.language === "jmx"}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
        {explorer.collapsed && (
          <CollapsedPanelToggle
            side="left"
            label="Show Explorer"
            testId="button-expand-explorer"
            onClick={explorer.expand}
          />
        )}
        {right.collapsed && (
          <CollapsedPanelToggle
            side="right"
            label="Show Test Suites"
            testId="button-expand-test-suites"
            onClick={right.expand}
          />
        )}
      </div>

      <WorkbenchDialogs
        dialogs={dialogs}
        tests={tests ?? []}
        solutionName={project.solutionName}
      />
      <OnboardingTour />
      <Footer />
    </div>
  );
}

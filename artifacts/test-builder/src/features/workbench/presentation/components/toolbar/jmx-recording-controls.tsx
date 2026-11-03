import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { NameJmxFileDialog } from "@/features/workbench/presentation/dialogs/name-jmx-file-dialog";
import {
  useJmxRecording,
  type UseJmxRecording,
} from "@/features/workbench/presentation/hooks/useJmxRecording";
import { consumeJmxAutoStart } from "@/features/workbench/presentation/hooks/jmx-auto-start";
import { StartOrBuildButton } from "./start-or-build-button";
import { StopRecordingButton } from "./stop-recording-button";

/**
 * JMX-mode replacement for the Playwright start/stop block in the
 * toolbar.
 *
 * Three UI states, driven by the server-authoritative status poll:
 *  - **No session**: just "Start Recording" — opens the name dialog,
 *    then launches the browser AND arms CDP capture in one shot
 *    (the existing single-click flow).
 *  - **Preview**: browser is live but nothing is being recorded yet.
 *    Shows "Start Recording" (which arms capture on the existing
 *    session — no second browser) plus a "Close Browser" button to
 *    discard the preview.
 *  - **Capturing**: "Stop Recording" only.
 *
 * Auto-open: when a JMX project was JUST created from the New Project
 * dialog, the `jmx-auto-start` marker is consumed on mount and the
 * recorder browser is opened in **preview-only** mode at the project's
 * target URL. The user then drives the page (login, navigation, …)
 * and clicks Start Recording when they're ready.
 */
export function JmxRecordingControls({
  projectId,
  jmxFiles,
  targetUrl,
  serverSessionId,
  serverIsCapturing,
}: {
  projectId: string;
  jmxFiles: readonly string[];
  targetUrl: string | null | undefined;
  serverSessionId?: string | null | undefined;
  serverIsCapturing?: boolean | undefined;
}) {
  const jmx = useJmxRecording(
    projectId,
    serverSessionId ?? null,
    serverIsCapturing ?? false,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const defaultName = computeDefaultJmxName(jmxFiles);

  // Auto-open the recording browser in PREVIEW mode when a JMX project
  // was just created from the New Project dialog. We require
  // `targetUrl` so the preview navigates somewhere meaningful, and
  // skip when a session is already live or pending.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!targetUrl) return;
    if (jmx.sessionLive || jmx.startPending) return;
    if (consumeJmxAutoStart(projectId)) {
      autoStartedRef.current = true;
      jmx.openPreview(defaultName, targetUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, targetUrl]);

  const handleStartClick = () => {
    // If a preview session is already live, "Start Recording" just
    // arms it — no name dialog, no second browser. The name was set
    // when the preview was opened.
    if (jmx.previewActive) {
      jmx.startRecording(defaultName, targetUrl ?? null);
      return;
    }
    setDialogOpen(true);
  };

  return (
    <>
      {renderControls(jmx, handleStartClick)}
      <NameJmxFileDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!jmx.startPending) setDialogOpen(v);
        }}
        defaultFileName={defaultName}
        isPending={jmx.startPending}
        onConfirm={(name) => {
          jmx.startRecording(name, targetUrl ?? null);
          setDialogOpen(false);
        }}
      />
    </>
  );
}

function renderControls(jmx: UseJmxRecording, onStartClick: () => void) {
  if (jmx.recording) {
    return (
      <StopRecordingButton
        onStop={() => jmx.stopRecording()}
        isPending={jmx.stopPending}
      />
    );
  }
  return (
    <>
      <StartOrBuildButton
        isApi={false}
        pendingApproval={false}
        onStart={onStartClick}
      />
      {jmx.previewActive && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => jmx.stopRecording()}
          disabled={jmx.stopPending}
          data-testid="button-close-jmx-browser"
          title="Close the preview browser without recording"
        >
          {jmx.stopPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <X className="h-4 w-4 mr-2" />
          )}
          Close Browser
        </Button>
      )}
    </>
  );
}

function computeDefaultJmxName(jmxFiles: readonly string[]): string {
  const next =
    jmxFiles
      .map((p) => /^jmx\/recording-(\d+)\.jmx$/.exec(p)?.[1])
      .map((s) => (s ? parseInt(s, 10) : 0))
      .reduce((max, n) => (n > max ? n : max), 0) + 1;
  return `recording-${next}.jmx`;
}

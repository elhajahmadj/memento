import { useState, useMemo } from "react";
import {
  listValidationRecordings,
  type RecordedRecordingDto,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";

import { ActionsFeed } from "./actions-feed";
import { TestBodyPreview } from "./test-body-preview";
import { HistoryPanel } from "./history-panel";
import { TestSuitesSection } from "./right-panel/test-suites-section";
import { RecordedActionsToolbar } from "./right-panel/recorded-actions-toolbar";
import { RightPanelDialogs } from "./right-panel/right-panel-dialogs";
import { useAssertionPrefill } from "./right-panel/use-assertion-prefill";

export function RightPanel({
  tests,
  testsLoading = false,
  testsError = null,
  onRetryTests,
  onAddClass,
  onAddMethod,
  onValidateClass,
  onValidateMethod,
  onValidateSession,
  recording,
  stopped,
  onCollapse,
  isJmx = false,
}: {
  tests: Array<{ className: string; path: string }>;
  testsLoading?: boolean | undefined;
  testsError?: Error | null | undefined;
  onRetryTests?: (() => void) | undefined;
  onAddClass: () => void;
  onAddMethod: (filePath: string) => void;
  onValidateClass: (filePath: string) => void;
  onValidateMethod: (filePath: string, methodName: string) => void;
  onValidateSession: () => void;
  recording: boolean;
  stopped: boolean;
  onCollapse?: (() => void) | undefined;
  // JMX projects hide all Validate affordances — the inline per-class /
  // per-method buttons in Test Suites and the "Validate" button in the
  // Recorded Actions toolbar — because JMX has its own recording/export
  // flow and doesn't use the Playwright-style validation pipeline.
  isJmx?: boolean | undefined;
}) {
  // Pull the user's recorded test methods so we can list each [Test]
  // method under its class with its own inline Validate button. We use
  // recordings as the source of truth here because only methods that
  // have an associated recording can be validated, and the existing
  // server endpoint for class metadata does not return method names.
  const { data: recordings } = useQuery<RecordedRecordingDto[]>({
    queryKey: ["validation", "recordings"],
    queryFn: () => listValidationRecordings(),
    staleTime: 10_000,
  });
  const methodsByPath = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of recordings ?? []) {
      if (r.kind !== "testMethod" || !r.methodName) continue;
      const arr = map.get(r.filePath) ?? [];
      if (!arr.includes(r.methodName)) arr.push(r.methodName);
      map.set(r.filePath, arr);
    }
    return map;
  }, [recordings]);

  const assertion = useAssertionPrefill();
  const [apiCheckOpen, setApiCheckOpen] = useState(false);
  const [waitOpen, setWaitOpen] = useState(false);
  const [captureLoginOpen, setCaptureLoginOpen] = useState(false);

  return (
    <div
      className="h-full flex flex-col bg-sidebar border-l border-sidebar-border"
      data-testid="workbench-right-panel"
    >
      {!isJmx && (
        <TestSuitesSection
          tests={tests}
          testsLoading={testsLoading}
          testsError={testsError}
          onRetryTests={onRetryTests}
          methodsByPath={methodsByPath}
          onAddClass={onAddClass}
          onAddMethod={onAddMethod}
          onValidateClass={onValidateClass}
          onValidateMethod={onValidateMethod}
          onCollapse={onCollapse}
        />
      )}
      <RecordedActionsToolbar
        recording={recording}
        stopped={stopped}
        onValidateSession={isJmx ? undefined : onValidateSession}
        onOpenAssertion={() => assertion.setOpen(true)}
        onOpenApiCheck={() => setApiCheckOpen(true)}
        onOpenWait={() => setWaitOpen(true)}
        onOpenCaptureLogin={() => setCaptureLoginOpen(true)}
      />
      <div className="flex-1 min-h-0 flex flex-col">
        <ActionsFeed />
      </div>
      <HistoryPanel recording={recording} stopped={stopped} />
      {(recording || stopped) && <TestBodyPreview />}
      <RightPanelDialogs
        assertionOpen={assertion.open}
        onAssertionOpenChange={(v) => {
          assertion.setOpen(v);
          if (!v) assertion.reset();
        }}
        assertionInitial={assertion.initial}
        assertionInsertBefore={assertion.insertBeforeIndex}
        apiCheckOpen={apiCheckOpen}
        onApiCheckOpenChange={setApiCheckOpen}
        waitOpen={waitOpen}
        onWaitOpenChange={setWaitOpen}
        captureLoginOpen={captureLoginOpen}
        onCaptureLoginOpenChange={setCaptureLoginOpen}
      />
    </div>
  );
}

import { useState, useEffect } from "react";
import {
  useGetRecordingStatus,
  getGetRecordingStatusQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Loader2 } from "lucide-react";

import { BaseUrlSection } from "./start-recording-dialog/base-url-section";
import { SavedLoginSection } from "./start-recording-dialog/saved-login-section";
import { SuiteTargetSection } from "./start-recording-dialog/suite-target-section";
import { TargetMethodSection } from "./start-recording-dialog/target-method-section";
import { TestCategorySection } from "./start-recording-dialog/test-category-section";
import { BrowserSizeSection } from "./start-recording-dialog/browser-size-section";
import { IgnoreTestSection } from "./start-recording-dialog/ignore-test-section";
import { KeepBrowserOpenSection } from "./start-recording-dialog/keep-browser-open-section";
import {
  ConfirmHookOverwriteDialog,
  ConfirmMethodOverwriteDialog,
} from "./start-recording-dialog/overwrite-dialogs";
import type {
  RecordingMode,
  RecordingTarget,
} from "./start-recording-dialog/types";
import { useNamedUrls } from "./start-recording-dialog/use-named-urls";
import { useSavedLogin } from "./start-recording-dialog/use-saved-login";
import { useViewport } from "./start-recording-dialog/use-viewport";
import { useRecentSuggestions } from "./start-recording-dialog/use-recent-suggestions";
import { useRecordingContext } from "./start-recording-dialog/use-recording-context";
import { useSubmit } from "./start-recording-dialog/use-submit";

export function StartRecordingDialog({
  open,
  onOpenChange,
  tests,
  attachToOpenBrowser = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tests: Array<{ className: string; path: string }>;
  // When true the dialog is being opened on top of a live
  // `/recording/open-browser` session. Base URL, viewport, and
  // saved-login are hidden (the browser is already open at the
  // user's chosen URL), Suite is forced to "Add to existing", and
  // Target is forced to a new [Test] method. Submit calls
  // `/recording/attach-to-open-browser` instead of
  // `/recording/start`.
  attachToOpenBrowser?: boolean;
}) {
  const urls = useNamedUrls(open);
  const {
    savedLoginInfo,
    useSavedLogin: useSavedLoginValue,
    setUseSavedLogin,
  } = useSavedLogin(open);
  const viewport = useViewport();
  const {
    recentCategories,
    setRecentCategories,
    recentIgnoreReasons,
    setRecentIgnoreReasons,
  } = useRecentSuggestions();

  const [methodName, setMethodName] = useState("RecordedFlow");
  const [mode, setMode] = useState<RecordingMode>("new");
  const [existingPath, setExistingPath] = useState<string | undefined>();
  const [newClassName, setNewClassName] = useState("RecordedTests");
  const [target, setTarget] = useState<RecordingTarget>("testMethod");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [confirmMethodOverwrite, setConfirmMethodOverwrite] = useState(false);
  const [overwriteMethodConsent, setOverwriteMethodConsent] = useState(false);
  const [ignoreEnabled, setIgnoreEnabled] = useState(false);
  const [ignoreReason, setIgnoreReason] = useState("");
  // Task #120 — when ticked, Stop Recording leaves the Chromium
  // browser alive and a successful Save recycles the session into a
  // pre-attach state so the next [Test] can attach to the same
  // browser without re-launching it. Off by default.
  const [keepBrowserOpen, setKeepBrowserOpen] = useState(false);
  const [categoryConstantName, setCategoryConstantName] = useState("");
  const [categoryValue, setCategoryValue] = useState("");
  const trimmedCategoryConstantName = categoryConstantName.trim();
  // When the user types a constant name that matches a remembered
  // category and hasn't yet typed a value, autofill the matching value
  // so picking from suggestions feels like picking a single item.
  useEffect(() => {
    if (categoryValue.trim() !== "") return;
    const match = recentCategories.find(
      (c) => c.constantName === trimmedCategoryConstantName,
    );
    if (match && match.value) setCategoryValue(match.value);
    // categoryValue intentionally omitted from deps: we only autofill
    // when the constant name changes, not on every keystroke in value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedCategoryConstantName, recentCategories]);
  const trimmedCategoryValue = categoryValue.trim();
  const trimmedIgnoreReason = ignoreReason.trim();
  const {
    isHook,
    hookLabel,
    isCsharp,
    finalMethodName,
    showAsyncPreview,
    hookStateQuery,
    hookHasCustomCode,
    hookCurrentBody,
    methodStateEnabled,
    methodStateQuery,
    methodCollision,
    suggestedMethodName,
    replayInfo,
    willReplay,
    wontReplay,
  } = useRecordingContext({ open, mode, target, existingPath, methodName });
  // On by default (it used to be unconditional); reset per open so an
  // opt-out never silently persists into the next recording.
  const [replaySetup, setReplaySetup] = useState(true);
  useEffect(() => {
    if (open) setReplaySetup(true);
  }, [open]);
  // Categories only apply to [Test] methods, not setup hooks. When a
  // hook is targeted, the category fields are disabled and treated as
  // empty for validation + payload purposes — leftover text from a
  // previous selection must not block the Start button or sneak into
  // the request.
  const categoryHalfFilled =
    !isHook &&
    (trimmedCategoryConstantName === "") !== (trimmedCategoryValue === "");
  const categoryConstantNameInvalid =
    !isHook &&
    trimmedCategoryConstantName.length > 0 &&
    !/^[A-Z][A-Za-z0-9]*$/.test(trimmedCategoryConstantName);
  const ignoreReasonMissing = ignoreEnabled && trimmedIgnoreReason === "";

  useEffect(() => {
    if (open) setOverwriteMethodConsent(false);
  }, [open]);
  // Task #120 — the "Keep browser open" preference must default to
  // off for every fresh dialog open, even when the dialog component
  // stays mounted between sessions (the workbench keeps both fresh
  // and attach instances alive). Resetting on open guarantees the
  // checkbox starts unchecked for each new recording.
  useEffect(() => {
    if (open) setKeepBrowserOpen(false);
  }, [open]);
  useEffect(() => {
    setOverwriteMethodConsent(false);
  }, [existingPath, mode, target]);

  // In attach mode the Suite is locked to "Add to existing" and the
  // Target to a new [Test] method (the server enforces both — these
  // resets keep the UI in sync if the user previously had different
  // values in the dialog state).
  useEffect(() => {
    if (!open || !attachToOpenBrowser) return;
    if (mode !== "existing") setMode("existing");
    if (target !== "testMethod") setTarget("testMethod");
    // We deliberately don't depend on mode/target here — the effect
    // only needs to clamp them when the dialog opens in attach mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attachToOpenBrowser]);

  // Task #120 — warn the user when they open the fresh-mode Start
  // Recording dialog while a kept-open browser is still alive in the
  // `stopped` phase. The workbench normally routes them through the
  // attach-to-open-browser path, but a defensive banner here makes
  // the lingering session visible even if they reach the fresh
  // dialog via a different entry point.
  const { data: liveStatus } = useGetRecordingStatus({
    query: {
      enabled: open && !attachToOpenBrowser,
      refetchInterval: false,
      queryKey: getGetRecordingStatusQueryKey(),
    },
  });
  // A kept-open session can be in two live shapes:
  //   - `stopped`            (right after Stop Recording was clicked)
  //   - `recording` + no methodName/targetClass (after a successful
  //     Save recycled it into the open-browser pre-attach state)
  // Warn in both cases so the user isn't surprised by a fresh start
  // tearing the live browser down.
  const showKeepBrowserOpenWarning =
    !attachToOpenBrowser &&
    liveStatus?.keepBrowserOpen === true &&
    (liveStatus?.phase === "stopped" ||
      (liveStatus?.phase === "recording" &&
        !liveStatus?.methodName &&
        !liveStatus?.targetClass));

  const { start, attach, submitStart, onClickStart } = useSubmit({
    attachToOpenBrowser,
    onOpenChange,
    startUrl: urls.startUrl,
    urlName: urls.urlName,
    viewportPreset: viewport.viewportPreset,
    viewportW: viewport.viewportW,
    viewportH: viewport.viewportH,
    viewportInRange: viewport.viewportInRange,
    mode,
    existingPath,
    newClassName,
    target,
    methodName,
    isCsharp,
    finalMethodName,
    isHook,
    hookHasCustomCode,
    methodCollision,
    overwriteMethodConsent,
    savedLoginInfo,
    useSavedLogin: useSavedLoginValue,
    replaySetup,
    trimmedCategoryConstantName,
    trimmedCategoryValue,
    categoryHalfFilled,
    categoryConstantNameInvalid,
    ignoreEnabled,
    trimmedIgnoreReason,
    ignoreReasonMissing,
    keepBrowserOpen,
    recentCategories,
    setRecentCategories,
    recentIgnoreReasons,
    setRecentIgnoreReasons,
    setConfirmOverwrite,
    setConfirmMethodOverwrite,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Start a new recording</DialogTitle>
          <DialogDescription>
            A headless Chromium session will start at the URL below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {showKeepBrowserOpenWarning && (
            <div
              className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200"
              data-testid="warning-keep-browser-open-active"
            >
              A previous recording left the browser open. Starting a fresh
              recording here will discard that live browser. To add another
              [Test] into the same suite, cancel this dialog and use the
              attach-to-open-browser flow instead.
            </div>
          )}
          {attachToOpenBrowser && (
            <div
              className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground"
              data-testid="note-attach-open-browser"
            >
              A browser is already open at the URL you chose. The recording
              will attach to that session — choose an existing suite and a
              method name below.
            </div>
          )}
          {!attachToOpenBrowser && (
            <BaseUrlSection
              hasNamedUrls={urls.hasNamedUrls}
              namedUrls={urls.namedUrls}
              urlSelection={urls.urlSelection}
              setUrlSelection={urls.setUrlSelection}
              urlName={urls.urlName}
              setUrlName={urls.setUrlName}
              startUrl={urls.startUrl}
              setStartUrl={urls.setStartUrl}
            />
          )}
          {!attachToOpenBrowser && savedLoginInfo?.hasState && (
            <SavedLoginSection
              savedLoginInfo={savedLoginInfo}
              useSavedLogin={useSavedLoginValue}
              setUseSavedLogin={setUseSavedLogin}
            />
          )}
          <SuiteTargetSection
            mode={mode}
            setMode={setMode}
            newClassName={newClassName}
            setNewClassName={setNewClassName}
            existingPath={existingPath}
            setExistingPath={setExistingPath}
            tests={tests}
            attachToOpenBrowser={attachToOpenBrowser}
            isHook={isHook}
            hookLabel={hookLabel}
            hookLoading={hookStateQuery.isLoading}
            hookHasCustomCode={hookHasCustomCode}
            hookCurrentBody={hookCurrentBody}
            showReplayInfo={!!replayInfo}
            willReplay={willReplay}
            wontReplay={wontReplay}
            replaySetup={replaySetup}
            onReplaySetupChange={setReplaySetup}
          />
          <TargetMethodSection
            target={target}
            setTarget={setTarget}
            attachToOpenBrowser={attachToOpenBrowser}
            testsCount={tests.length}
            setMode={setMode}
            isHook={isHook}
            hookLabel={hookLabel}
            methodName={methodName}
            setMethodName={setMethodName}
            resetOverwriteConsent={() => setOverwriteMethodConsent(false)}
            showAsyncPreview={showAsyncPreview}
            finalMethodName={finalMethodName}
            methodCollision={methodCollision}
            suggestedMethodName={suggestedMethodName}
          />
        </div>
        <TestCategorySection
          isHook={isHook}
          categoryConstantName={categoryConstantName}
          setCategoryConstantName={setCategoryConstantName}
          categoryValue={categoryValue}
          setCategoryValue={setCategoryValue}
          recentCategories={recentCategories}
          categoryHalfFilled={categoryHalfFilled}
          categoryConstantNameInvalid={categoryConstantNameInvalid}
        />
        {!attachToOpenBrowser && (
          <BrowserSizeSection
            viewportPreset={viewport.viewportPreset}
            setViewportPreset={viewport.setViewportPreset}
            viewportW={viewport.viewportW}
            setViewportW={viewport.setViewportW}
            viewportH={viewport.viewportH}
            setViewportH={viewport.setViewportH}
            viewportInRange={viewport.viewportInRange}
          />
        )}
        <IgnoreTestSection
          ignoreEnabled={ignoreEnabled}
          setIgnoreEnabled={setIgnoreEnabled}
          ignoreReason={ignoreReason}
          setIgnoreReason={setIgnoreReason}
          recentIgnoreReasons={recentIgnoreReasons}
          ignoreReasonMissing={ignoreReasonMissing}
        />
        <KeepBrowserOpenSection
          keepBrowserOpen={keepBrowserOpen}
          setKeepBrowserOpen={setKeepBrowserOpen}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onClickStart}
            disabled={
              start.isPending ||
              attach.isPending ||
              (isHook && hookStateQuery.isLoading) ||
              (methodStateEnabled && methodStateQuery.isLoading)
            }
            data-testid="button-confirm-start-recording"
          >
            {start.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
      <ConfirmHookOverwriteDialog
        open={confirmOverwrite}
        onOpenChange={setConfirmOverwrite}
        hookLabel={hookLabel}
        hookCurrentBody={hookCurrentBody}
        onConfirm={() => {
          setConfirmOverwrite(false);
          submitStart();
        }}
      />
      <ConfirmMethodOverwriteDialog
        open={confirmMethodOverwrite}
        onOpenChange={setConfirmMethodOverwrite}
        finalMethodName={finalMethodName}
        onConfirm={() => {
          setConfirmMethodOverwrite(false);
          setOverwriteMethodConsent(true);
          submitStart({ overwriteExistingMethod: true });
        }}
      />
    </Dialog>
  );
}

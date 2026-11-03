import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  useStartRecording,
  useAttachToOpenBrowser,
  getGetRecordingStatusQueryKey,
} from "@workspace/api-client-react";
import {
  RECENT_CATEGORIES_KEY,
  RECENT_IGNORE_REASONS_KEY,
  RECENT_LIMIT,
  VIEWPORT_STORAGE_KEY,
} from "./constants";
import type {
  RecentCategory,
  RecordingMode,
  RecordingTarget,
  SavedLoginInfo,
  ViewportPreset,
} from "./types";

export type UseSubmitState = {
  attachToOpenBrowser: boolean;
  onOpenChange: (v: boolean) => void;
  // URL + viewport (fresh mode only)
  startUrl: string;
  urlName: string;
  viewportPreset: ViewportPreset;
  viewportW: number;
  viewportH: number;
  viewportInRange: boolean;
  // Suite / method
  mode: RecordingMode;
  existingPath: string | undefined;
  newClassName: string;
  target: RecordingTarget;
  methodName: string;
  isCsharp: boolean;
  finalMethodName: string;
  isHook: boolean;
  hookHasCustomCode: boolean;
  methodCollision: boolean;
  overwriteMethodConsent: boolean;
  // Saved login
  savedLoginInfo: SavedLoginInfo | null;
  // Setup replay: whether stored setup-hook actions run before recording.
  replaySetup: boolean;
  useSavedLogin: boolean;
  // Category
  trimmedCategoryConstantName: string;
  trimmedCategoryValue: string;
  categoryHalfFilled: boolean;
  categoryConstantNameInvalid: boolean;
  // Ignore
  ignoreEnabled: boolean;
  trimmedIgnoreReason: string;
  ignoreReasonMissing: boolean;
  // Keep browser open
  keepBrowserOpen: boolean;
  // Recent suggestions
  recentCategories: RecentCategory[];
  setRecentCategories: (v: RecentCategory[]) => void;
  recentIgnoreReasons: string[];
  setRecentIgnoreReasons: (v: string[]) => void;
  // Overwrite dialog triggers
  setConfirmOverwrite: (v: boolean) => void;
  setConfirmMethodOverwrite: (v: boolean) => void;
};

export function useSubmit(s: UseSubmitState) {
  const qc = useQueryClient();
  const start = useStartRecording({
    mutation: {
      onSuccess: async () => {
        toast.success("Recording started");
        await qc.invalidateQueries({
          queryKey: getGetRecordingStatusQueryKey(),
        });
        s.onOpenChange(false);
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to start"),
    },
  });
  // Used when `attachToOpenBrowser` is true. The browser is already
  // open at a user-chosen URL via /recording/open-browser; this
  // mutation just promotes that pre-attach session into a real
  // recording on a [Test] method in an existing suite.
  const attach = useAttachToOpenBrowser({
    mutation: {
      onSuccess: async () => {
        toast.success("Recording started");
        await qc.invalidateQueries({
          queryKey: getGetRecordingStatusQueryKey(),
        });
        s.onOpenChange(false);
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to start"),
    },
  });

  function submitStart(opts?: { overwriteExistingMethod?: boolean }) {
    const useExisting = s.mode === "existing";
    const overwriteOpt =
      opts?.overwriteExistingMethod ?? s.overwriteMethodConsent;
    // Re-check viewport bounds here so the overwrite-confirmation paths
    // (which call submitStart directly) can't bypass the client-side guard.
    // Attach mode doesn't own the viewport — the open-browser session
    // already set it — so skip the bounds check in that mode.
    if (!s.attachToOpenBrowser && !s.viewportInRange) {
      toast.error(
        "Browser size out of range (width 320–3840, height 240–2160).",
      );
      return;
    }
    try {
      window.localStorage.setItem(
        VIEWPORT_STORAGE_KEY,
        JSON.stringify({
          preset: s.viewportPreset,
          width: s.viewportW,
          height: s.viewportH,
        }),
      );
    } catch {
      // localStorage may be unavailable; ignore
    }
    if (s.categoryHalfFilled) {
      toast.error(
        "Test category constant name and value must be filled together (both or neither).",
      );
      return;
    }
    if (s.categoryConstantNameInvalid) {
      toast.error(
        "Test category constant name must be PascalCase (start with an uppercase letter, letters and digits only).",
      );
      return;
    }
    if (s.ignoreReasonMissing) {
      toast.error(
        "Ignore reason is required when 'Ignore this test' is checked.",
      );
      return;
    }
    // Remember the values the user just used as MRU suggestions for
    // the next recording. We persist on submit (not on every keystroke)
    // so half-typed values never pollute the suggestions list.
    try {
      if (
        !s.isHook &&
        s.trimmedCategoryConstantName &&
        s.trimmedCategoryValue
      ) {
        const next: RecentCategory[] = [
          {
            constantName: s.trimmedCategoryConstantName,
            value: s.trimmedCategoryValue,
          },
          ...s.recentCategories.filter(
            (c) =>
              c.constantName !== s.trimmedCategoryConstantName ||
              c.value !== s.trimmedCategoryValue,
          ),
        ].slice(0, RECENT_LIMIT);
        s.setRecentCategories(next);
        window.localStorage.setItem(
          RECENT_CATEGORIES_KEY,
          JSON.stringify(next),
        );
      }
      if (s.ignoreEnabled && s.trimmedIgnoreReason) {
        const nextReasons = [
          s.trimmedIgnoreReason,
          ...s.recentIgnoreReasons.filter((r) => r !== s.trimmedIgnoreReason),
        ].slice(0, RECENT_LIMIT);
        s.setRecentIgnoreReasons(nextReasons);
        window.localStorage.setItem(
          RECENT_IGNORE_REASONS_KEY,
          JSON.stringify(nextReasons),
        );
      }
    } catch {
      // localStorage may be unavailable; suggestions just won't persist
    }
    if (s.attachToOpenBrowser) {
      // Attach-mode submit. The server enforces existing-suite +
      // [Test] target so we only ever read the existing branch
      // here.
      const trimmedMethod = s.isCsharp ? s.finalMethodName : s.methodName.trim();
      attach.mutate({
        data: {
          existingTestClassPath: s.existingPath ?? "",
          methodName: trimmedMethod,
          overwriteExistingMethod: overwriteOpt,
          ignoreReason:
            s.ignoreEnabled && s.trimmedIgnoreReason
              ? s.trimmedIgnoreReason
              : null,
          categoryConstantName: s.trimmedCategoryConstantName || null,
          categoryValue: s.trimmedCategoryValue || null,
          keepBrowserOpen: s.keepBrowserOpen,
        },
      });
      return;
    }
    start.mutate({
      data: {
        startUrl: s.startUrl,
        urlName: s.urlName.trim(),
        target: s.target,
        methodName:
          s.target === "testMethod"
            ? s.isCsharp
              ? s.finalMethodName
              : s.methodName
            : null,
        existingTestClassPath: useExisting ? s.existingPath ?? null : null,
        newTestClassName: s.mode === "new" ? s.newClassName : null,
        overwriteExistingMethod:
          s.target === "testMethod" && useExisting ? overwriteOpt : false,
        viewport: { width: s.viewportW, height: s.viewportH },
        useSavedLogin: s.useSavedLogin && !!s.savedLoginInfo?.hasState,
        // Only meaningful for a [Test] into an existing class; the server
        // ignores it otherwise. Sent explicitly so an opt-out is honoured.
        replaySetup: s.replaySetup,
        ignoreReason:
          s.ignoreEnabled && s.trimmedIgnoreReason
            ? s.trimmedIgnoreReason
            : null,
        categoryConstantName: s.isHook
          ? null
          : s.trimmedCategoryConstantName || null,
        categoryValue: s.isHook ? null : s.trimmedCategoryValue || null,
        keepBrowserOpen: s.keepBrowserOpen,
      },
    });
  }

  function onClickStart() {
    // Base URL + viewport are fresh-flow-only — in attach
    // mode the open-browser session already owns the URL
    // and viewport, and those sections aren't even
    // rendered, so skip their validations.
    if (!s.attachToOpenBrowser) {
      if (!s.startUrl.trim()) {
        toast.error("Start URL is required");
        return;
      }
      if (!s.urlName.trim()) {
        toast.error("URL name is required");
        return;
      }
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s.urlName.trim())) {
        toast.error(
          "URL name must start with a letter and contain only letters, digits, or underscores",
        );
        return;
      }
    }
    if (s.target === "testMethod" && !s.methodName.trim()) {
      toast.error("Test method name is required");
      return;
    }
    if (s.mode === "existing" && !s.existingPath) {
      toast.error("Choose an existing test suite");
      return;
    }
    if (s.mode === "new" && !s.newClassName.trim()) {
      toast.error("Enter a name for the new test suite");
      return;
    }
    if (s.hookHasCustomCode) {
      s.setConfirmOverwrite(true);
      return;
    }
    if (s.methodCollision && !s.overwriteMethodConsent) {
      s.setConfirmMethodOverwrite(true);
      return;
    }
    if (!s.attachToOpenBrowser && !s.viewportInRange) {
      toast.error(
        "Browser size out of range (width 320–3840, height 240–2160).",
      );
      return;
    }
    if (s.categoryHalfFilled) {
      toast.error(
        "Test category constant name and value must be filled together (both or neither).",
      );
      return;
    }
    if (s.categoryConstantNameInvalid) {
      toast.error(
        "Test category constant name must be PascalCase (start with an uppercase letter, letters and digits only).",
      );
      return;
    }
    if (s.ignoreReasonMissing) {
      toast.error(
        "Ignore reason is required when 'Ignore this test' is checked.",
      );
      return;
    }
    submitStart();
  }

  return { start, attach, submitStart, onClickStart };
}

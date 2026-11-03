import {
  useGetCurrentProject,
  useGetHookState,
  useGetMethodState,
  useGetReplayableHooks,
  getGetHookStateQueryKey,
  getGetMethodStateQueryKey,
  getGetReplayableHooksQueryKey,
} from "@workspace/api-client-react";
import { ensureAsyncSuffix } from "@/features/codegen";
import type { RecordingMode, RecordingTarget } from "./types";

export function useRecordingContext({
  open,
  mode,
  target,
  existingPath,
  methodName,
}: {
  open: boolean;
  mode: RecordingMode;
  target: RecordingTarget;
  existingPath: string | undefined;
  methodName: string;
}) {
  const isHook = target !== "testMethod";
  const hookLabel =
    target === "beforeEach" ? "BeforeEachAsync" : "OneTimeSetUpAsync";

  // For C# projects every async test method must end in `Async`.
  // Apply the suffix to the typed value before sending it to the
  // server (so collision detection compares the final on-disk name)
  // and surface the suffixed form as a live preview under the input.
  // The server enforces the same rule — this is purely cosmetic
  // alignment so the dialog and the file on disk agree.
  const projectQuery = useGetCurrentProject();
  const projectLanguage = projectQuery.data?.project?.language ?? null;
  const isCsharp = projectLanguage === "csharp";
  const trimmedMethodName = methodName.trim();
  const finalMethodName = isCsharp
    ? ensureAsyncSuffix(trimmedMethodName)
    : trimmedMethodName;
  const showAsyncPreview =
    isCsharp &&
    !isHook &&
    !!trimmedMethodName &&
    finalMethodName !== trimmedMethodName;

  const hookStateParams = {
    filePath: existingPath ?? "",
    hook: (target === "testMethod" ? "beforeEach" : target) as
      | "beforeEach"
      | "oneTimeSetup",
  };
  // Only inspect hook state when we're actually targeting an existing
  // class for a hook recording. In `mode === "new"` the class doesn't
  // exist yet, so any stale `existingPath` left over from a previous
  // selection must not trigger the hook-overwrite confirmation flow.
  const hookExistingTarget = isHook && mode === "existing";
  const hookStateQuery = useGetHookState(hookStateParams, {
    query: {
      enabled: hookExistingTarget && !!existingPath && open,
      staleTime: 0,
      queryKey: getGetHookStateQueryKey(hookStateParams),
    },
  });
  const hookHasCustomCode =
    hookExistingTarget &&
    !!existingPath &&
    hookStateQuery.data?.isDefault === false;
  const hookCurrentBody = hookHasCustomCode
    ? hookStateQuery.data?.body ?? ""
    : "";

  const methodStateEnabled =
    !isHook &&
    mode === "existing" &&
    !!existingPath &&
    !!trimmedMethodName &&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedMethodName) &&
    open;
  const methodStateParams = {
    filePath: existingPath ?? "",
    methodName: finalMethodName,
  };
  const methodStateQuery = useGetMethodState(methodStateParams, {
    query: {
      enabled: methodStateEnabled,
      staleTime: 0,
      queryKey: getGetMethodStateQueryKey(methodStateParams),
    },
  });
  const methodCollision =
    methodStateEnabled && methodStateQuery.data?.exists === true;
  const suggestedMethodName =
    methodStateQuery.data?.suggestedName ?? finalMethodName;

  // When recording a [Test] into an EXISTING class, peek at which setup
  // hooks the server can replay before the user starts recording. The UI
  // surfaces both halves: hooks that will run automatically vs hooks
  // that exist but won't run (hand-written or recorded before this
  // feature).
  const replayableHooksParams = { filePath: existingPath ?? "" };
  const replayableHooksEnabled =
    !isHook && mode === "existing" && !!existingPath && open;
  const replayableHooksQuery = useGetReplayableHooks(replayableHooksParams, {
    query: {
      enabled: replayableHooksEnabled,
      staleTime: 0,
      queryKey: getGetReplayableHooksQueryKey(replayableHooksParams),
    },
  });
  const replayInfo = replayableHooksEnabled
    ? replayableHooksQuery.data
    : undefined;
  const willReplay: string[] = [];
  const wontReplay: string[] = [];
  if (replayInfo) {
    if (replayInfo.oneTimeSetup.hasStoredActions) {
      willReplay.push("OneTimeSetUpAsync");
    } else if (replayInfo.oneTimeSetup.hasCustomBody) {
      wontReplay.push("OneTimeSetUpAsync");
    }
    if (replayInfo.beforeEach.hasStoredActions) {
      willReplay.push("BeforeEachAsync");
    } else if (replayInfo.beforeEach.hasCustomBody) {
      wontReplay.push("BeforeEachAsync");
    }
  }

  return {
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
  };
}

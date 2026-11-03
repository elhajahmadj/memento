/**
 * Shared `vi.mock("@workspace/api-client-react", ...)` setup for the
 * <StartRecordingDialog /> RTL specs.
 *
 * Why this exists: the dialog pulls in a large surface of generated
 * React Query hooks. Each spec used to hand-roll its own ~70-line
 * `vi.mock` listing every hook the dialog touches. When the dialog
 * grew a new hook (e.g. `useAttachToOpenBrowser`), the mocks went
 * stale silently — there is no compile-time check linking a `vi.mock`
 * factory to the real module's exports — and every test in the stale
 * file blew up with a generic "No export defined" runtime error.
 *
 * Centralising the mock here means adding a new hook the dialog uses
 * only requires touching one file.
 *
 * Usage in a test file:
 *
 *   import {
 *     startMutate,
 *     attachMutate,
 *     resetApiClientMocks,
 *   } from "./_mock-api-client-react";
 *   // ...then `startMutate.mock.calls[0]![0]` etc. in assertions.
 *
 * Importing this module is enough to register the mock — the `vi.mock`
 * call runs at module load time, before the test file's imports of
 * `@workspace/api-client-react` resolve.
 */
import { vi } from "vitest";

const captures = vi.hoisted(() => ({
  startMutate: vi.fn(),
  attachMutate: vi.fn(),
}));

export const startMutate = captures.startMutate;
export const attachMutate = captures.attachMutate;

vi.mock("@workspace/api-client-react", () => {
  const inertQuery = () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  const inertMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  });
  const capturingMutation =
    (capture: (vars: unknown) => void) =>
    ({
      mutation,
    }: {
      mutation?: { onSuccess?: () => void; onError?: (e: Error) => void };
    } = {}) => ({
      mutate: (vars: unknown) => {
        capture(vars);
        mutation?.onSuccess?.();
      },
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    });
  return {
    useGetCurrentProject: inertQuery,
    useGetProjectTree: inertQuery,
    useGetFileContent: inertQuery,
    useDeleteFile: inertMutation,
    useRenameFile: inertMutation,
    useCreateFile: inertMutation,
    useCreateFolder: inertMutation,
    useListTestClasses: inertQuery,
    useGenerateTestClass: inertMutation,
    useGenerateTestMethod: inertMutation,
    useUpdateFile: inertMutation,
    useGetRecordingStatus: inertQuery,
    useGetRecordingNamedUrls: inertQuery,
    useUpsertRecordingNamedUrl: inertMutation,
    useDeleteRecordingNamedUrl: inertMutation,
    getGetRecordingNamedUrlsQueryKey: () => ["recording-named-urls"],
    useStartRecording: capturingMutation(startMutate),
    useAttachToOpenBrowser: capturingMutation(attachMutate),
    useGetHookState: inertQuery,
    useGetMethodState: inertQuery,
    useGetReplayableHooks: inertQuery,
    useStopRecording: inertMutation,
    useFinalizeRecording: inertMutation,
    discardRecordingSession: vi.fn(),
    getGetReplayableHooksQueryKey: () => ["replayable-hooks"],
    getGetProjectTreeQueryKey: () => ["project-tree"],
    getGetFileContentQueryKey: () => ["file-content"],
    getGetHookStateQueryKey: () => ["hook-state"],
    getGetMethodStateQueryKey: () => ["method-state"],
    getListTestClassesQueryKey: () => ["test-classes"],
    getGetRecordingStatusQueryKey: () => ["recording-status"],
    listMyApprovals: vi.fn(),
    listValidationRecordings: vi.fn(),
  };
});

export function resetApiClientMocks(): void {
  startMutate.mockReset();
  attachMutate.mockReset();
}

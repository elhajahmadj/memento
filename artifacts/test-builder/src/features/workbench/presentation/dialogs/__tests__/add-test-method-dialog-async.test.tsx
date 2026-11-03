/**
 * Focused RTL spec for <AddTestMethodDialog /> proving the live
 * "Will be generated as <X>Async" preview hint for C# (the file
 * extension drives the language detection) and verifying the
 * mutation payload submits the suffixed name. Non-C# files
 * (`.py`, `.ts`, `.java`) must NOT show the hint and must
 * forward the typed name verbatim.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
} from "@testing-library/react";

const { genMutate } = vi.hoisted(() => ({ genMutate: vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

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
    useGenerateTestMethod: () => ({
      mutate: (vars: unknown) => {
        genMutate(vars);
      },
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    }),
    useUpdateFile: inertMutation,
    useGetRecordingStatus: inertQuery,
    useStartRecording: inertMutation,
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

vi.mock("@/features/auth/presentation/role", () => ({
  useIsAnyAdmin: () => true,
  AnyAdminOnly: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { AddTestMethodDialog } from "../add-test-method-dialog";
import { renderWithProviders } from "@/test/test-utils";

beforeEach(() => {
  genMutate.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("<AddTestMethodDialog /> — C# Async suffix preview", () => {
  it("shows the live Async preview as the user types into a .cs file", () => {
    renderWithProviders(
      <AddTestMethodDialog
        filePath="Tests/SampleTests.cs"
        onClose={() => {}}
      />,
    );
    // Empty input: no preview yet.
    expect(screen.queryByTestId("hint-method-async-preview")).toBeNull();

    fireEvent.change(screen.getByTestId("input-new-method"), {
      target: { value: "RecordedFlow" },
    });
    const hint = screen.getByTestId("hint-method-async-preview");
    expect(hint.textContent).toContain("RecordedFlowAsync");

    // Idempotent: typing the suffixed form removes the hint (it would
    // be a no-op).
    fireEvent.change(screen.getByTestId("input-new-method"), {
      target: { value: "RecordedFlowAsync" },
    });
    expect(screen.queryByTestId("hint-method-async-preview")).toBeNull();
  });

  it("submits the suffixed methodName for C# files", () => {
    renderWithProviders(
      <AddTestMethodDialog
        filePath="Tests/SampleTests.cs"
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("input-new-method"), {
      target: { value: "RecordedFlow" },
    });
    fireEvent.click(screen.getByTestId("button-confirm-method"));
    expect(genMutate).toHaveBeenCalledTimes(1);
    const vars = genMutate.mock.calls[0]![0] as {
      data: { filePath: string; methodName: string };
    };
    expect(vars.data.methodName).toBe("RecordedFlowAsync");
  });

  it("does NOT show the preview and forwards the name verbatim for a .py file", () => {
    renderWithProviders(
      <AddTestMethodDialog
        filePath="tests/test_sample.py"
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("input-new-method"), {
      target: { value: "recorded_flow" },
    });
    expect(screen.queryByTestId("hint-method-async-preview")).toBeNull();

    fireEvent.click(screen.getByTestId("button-confirm-method"));
    expect(genMutate).toHaveBeenCalledTimes(1);
    const vars = genMutate.mock.calls[0]![0] as {
      data: { filePath: string; methodName: string };
    };
    expect(vars.data.methodName).toBe("recorded_flow");
  });

  it("does NOT show the preview for a Node.js (.spec.ts) file", () => {
    renderWithProviders(
      <AddTestMethodDialog
        filePath="tests/sample.spec.ts"
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("input-new-method"), {
      target: { value: "recordedFlow" },
    });
    expect(screen.queryByTestId("hint-method-async-preview")).toBeNull();
  });
});

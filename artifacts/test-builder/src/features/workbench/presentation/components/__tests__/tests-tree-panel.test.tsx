/**
 * RTL specs for <TestsTreePanel />.
 *
 * Pins the loading skeleton, the empty + error states with a working
 * retry, kind badges + folder totals, the tri-state folder checkbox
 * math, and the "Run selected" mutation shape (testIds payload +
 * navigation to the run-detail surface).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  TestDiscoveryResponse,
  RunBySelectionResponse,
} from "@workspace/api-client-react";

const useDiscoverProjectTestsMock = vi.fn<(...args: unknown[]) => unknown>();
const mutateAsyncMock = vi.fn();
const useRunProjectTestsBySelectionMock = vi.fn<
  (...args: unknown[]) => unknown
>(() => ({
  mutateAsync: mutateAsyncMock,
  isPending: false,
}));
const navigateMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useDiscoverProjectTests: (projectId: string, options?: unknown) =>
    useDiscoverProjectTestsMock(projectId, options),
  useRunProjectTestsBySelection: (options?: unknown) =>
    useRunProjectTestsBySelectionMock(options),
  getDiscoverProjectTestsQueryKey: (projectId: string) => [
    `/api/projects/${projectId}/tests`,
  ],
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/workbench", navigateMock],
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccessMock(...a),
    error: (...a: unknown[]) => toastErrorMock(...a),
  },
}));

const useAuthMock = vi.fn(() => ({
  user: { id: "user-1", username: "alice", role: "admin" },
}));
vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

import { TestsTreePanel } from "../tests-tree-panel";

const sampleTree: TestDiscoveryResponse = {
  projectName: "MementoDemo",
  slnPath: "demo.sln",
  root: {
    type: "folder",
    name: "MementoDemo",
    path: ".",
    totals: { e2e: 2, unit: 1, api: 1, all: 4 },
    children: [
      {
        type: "folder",
        name: "e2e",
        path: "e2e",
        totals: { e2e: 2, unit: 0, api: 0, all: 2 },
        children: [
          {
            type: "file",
            name: "LoginSuite.cs",
            path: "e2e/LoginSuite.cs",
            language: "csharp",
            totals: { e2e: 2, unit: 0, api: 0, all: 2 },
            methods: [
              {
                type: "method",
                id: "id::login::happy",
                name: "HappyPath",
                kind: "e2e",
                language: "csharp",
              },
              {
                type: "method",
                id: "id::login::sad",
                name: "SadPath",
                kind: "e2e",
                language: "csharp",
              },
            ],
          },
        ],
      },
      {
        type: "folder",
        name: "unit",
        path: "unit",
        totals: { e2e: 0, unit: 1, api: 1, all: 2 },
        children: [
          {
            type: "file",
            name: "MathTests.cs",
            path: "unit/MathTests.cs",
            language: "csharp",
            totals: { e2e: 0, unit: 1, api: 0, all: 1 },
            methods: [
              {
                type: "method",
                id: "id::math::add",
                name: "AddsTwoNumbers",
                kind: "unit",
                language: "csharp",
              },
            ],
          },
          {
            type: "file",
            name: "ApiTests.cs",
            path: "unit/ApiTests.cs",
            language: "csharp",
            totals: { e2e: 0, unit: 0, api: 1, all: 1 },
            methods: [
              {
                type: "method",
                id: "id::api::ping",
                name: "Ping",
                kind: "api",
                language: "csharp",
              },
            ],
          },
        ],
      },
    ],
  },
};

afterEach(() => cleanup());
beforeEach(() => {
  window.localStorage.clear();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({
    user: { id: "user-1", username: "alice", role: "admin" },
  });
  useDiscoverProjectTestsMock.mockReset();
  mutateAsyncMock.mockReset();
  useRunProjectTestsBySelectionMock.mockReset();
  useRunProjectTestsBySelectionMock.mockImplementation(() => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }));
  navigateMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

function mockSuccess(data: TestDiscoveryResponse = sampleTree) {
  useDiscoverProjectTestsMock.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  });
}

describe("<TestsTreePanel />", () => {
  it("shows a loading skeleton while discovery is in flight", () => {
    useDiscoverProjectTestsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      isFetching: true,
      refetch: vi.fn(),
    });
    render(<TestsTreePanel projectId="demo.sln" />);
    expect(screen.getByTestId("tests-tree-loading")).toBeDefined();
  });

  it("renders an error banner with a working Retry", () => {
    const refetch = vi.fn();
    useDiscoverProjectTestsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("discovery failed"),
      isFetching: false,
      refetch,
    });
    render(<TestsTreePanel projectId="demo.sln" />);
    const block = screen.getByTestId("tests-tree-error");
    expect(block.textContent).toContain("Couldn't load discovered tests.");
    expect(block.textContent).toContain("discovery failed");
    fireEvent.click(screen.getByTestId("button-tests-tree-retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when the project has no discovered tests", () => {
    useDiscoverProjectTestsMock.mockReturnValue({
      data: {
        projectName: "Empty",
        slnPath: "empty.sln",
        root: {
          type: "folder",
          name: "Empty",
          path: ".",
          totals: { e2e: 0, unit: 0, api: 0, all: 0 },
          children: [],
        },
      } satisfies TestDiscoveryResponse,
      isLoading: false,
      isError: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    });
    render(<TestsTreePanel projectId="demo.sln" />);
    expect(screen.getByTestId("tests-tree-empty").textContent).toContain(
      "No tests discovered yet.",
    );
  });

  it("renders rolled-up totals on the root folder", () => {
    mockSuccess();
    render(<TestsTreePanel projectId="demo.sln" />);
    const totals = screen.getByTestId("tests-tree-root-totals");
    expect(totals.textContent).toContain("2 E2E");
    expect(totals.textContent).toContain("1 Unit");
    expect(totals.textContent).toContain("1 API");
  });

  it("disables Run selected until at least one test is selected", () => {
    mockSuccess();
    render(<TestsTreePanel projectId="demo.sln" />);
    const btn = screen.getByTestId(
      "button-tests-tree-run-selected",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(
      screen.getByTestId("tests-tree-method-checkbox-id::math::add"),
    );
    expect(btn.disabled).toBe(false);
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "1 selected",
    );
  });

  it("tri-state folder checkbox selects every method underneath", () => {
    mockSuccess();
    render(<TestsTreePanel projectId="demo.sln" />);
    // Folder e2e has two methods underneath; one toggle should select both.
    fireEvent.click(screen.getByTestId("tests-tree-folder-checkbox-e2e"));
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "2 selected",
    );
    // Toggling the same checkbox a second time clears them all.
    fireEvent.click(screen.getByTestId("tests-tree-folder-checkbox-e2e"));
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "0 selected",
    );
  });

  it("select-all-in-project toggles every discovered method", () => {
    mockSuccess();
    render(<TestsTreePanel projectId="demo.sln" />);
    fireEvent.click(screen.getByTestId("tests-tree-root-checkbox"));
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "4 selected",
    );
  });

  it("dispatches Run selected with the selected ids and navigates to the runs page", async () => {
    mockSuccess();
    mutateAsyncMock.mockResolvedValueOnce({
      runs: [
        {
          id: "run-abc",
          suiteKey: "selection",
          suiteName: "Selection (csharp, 2 tests)",
          startedAt: "2026-05-13T00:00:00.000Z",
          finishedAt: null,
          status: "running",
          exitCode: null,
          errorMessage: null,
          startedBy: { id: "user-1", username: "alice" },
          language: "csharp",
          testIds: ["id::math::add", "id::api::ping"],
          stdout: "",
          stderr: "",
        },
      ],
    } satisfies RunBySelectionResponse);
    render(<TestsTreePanel projectId="demo.sln" />);
    fireEvent.click(
      screen.getByTestId("tests-tree-method-checkbox-id::math::add"),
    );
    fireEvent.click(
      screen.getByTestId("tests-tree-method-checkbox-id::api::ping"),
    );
    fireEvent.click(screen.getByTestId("button-tests-tree-run-selected"));
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    const call = mutateAsyncMock.mock.calls[0][0] as {
      projectId: string;
      data: { testIds: string[] };
    };
    expect(call.projectId).toBe("demo.sln");
    expect(call.data.testIds.sort()).toEqual(
      ["id::math::add", "id::api::ping"].sort(),
    );
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        "/tools/selection-runs/demo.sln/run-abc",
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("remembers selection per user + project across remounts (refresh)", () => {
    mockSuccess();
    const { unmount } = render(<TestsTreePanel projectId="demo.sln" />);
    fireEvent.click(
      screen.getByTestId("tests-tree-method-checkbox-id::math::add"),
    );
    fireEvent.click(
      screen.getByTestId("tests-tree-method-checkbox-id::api::ping"),
    );
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "2 selected",
    );
    unmount();

    // Same user + project: picks come back.
    mockSuccess();
    render(<TestsTreePanel projectId="demo.sln" />);
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "2 selected",
    );
  });

  it("scopes remembered selection per project (switch + back)", () => {
    mockSuccess();
    const { rerender } = render(<TestsTreePanel projectId="demo.sln" />);
    fireEvent.click(
      screen.getByTestId("tests-tree-method-checkbox-id::math::add"),
    );
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "1 selected",
    );

    // Switch projects — sibling project starts empty.
    mockSuccess();
    rerender(<TestsTreePanel projectId="other.sln" />);
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "0 selected",
    );

    // Back to the first project — its pick is still there.
    mockSuccess();
    rerender(<TestsTreePanel projectId="demo.sln" />);
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "1 selected",
    );
  });

  it("scopes remembered selection per user (different user sees nothing)", () => {
    mockSuccess();
    const { unmount } = render(<TestsTreePanel projectId="demo.sln" />);
    fireEvent.click(
      screen.getByTestId("tests-tree-method-checkbox-id::math::add"),
    );
    unmount();

    useAuthMock.mockReturnValue({
      user: { id: "user-2", username: "bob", role: "admin" },
    });
    mockSuccess();
    render(<TestsTreePanel projectId="demo.sln" />);
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "0 selected",
    );
  });

  it("search input filters the tree by name (case-insensitive)", () => {
    mockSuccess();
    render(<TestsTreePanel projectId="demo.sln" />);
    fireEvent.change(screen.getByTestId("tests-tree-search-input"), {
      target: { value: "happy" },
    });
    // Matching method survives.
    expect(
      screen.queryByTestId("tests-tree-method-id::login::happy"),
    ).not.toBeNull();
    // Non-matching siblings are pruned.
    expect(
      screen.queryByTestId("tests-tree-method-id::login::sad"),
    ).toBeNull();
    expect(
      screen.queryByTestId("tests-tree-method-id::math::add"),
    ).toBeNull();
    // Folders that no longer have any matching descendant disappear.
    expect(screen.queryByTestId("tests-tree-folder-unit")).toBeNull();
    // Root totals reflect the visible subset (1 E2E, no Unit/API).
    const totals = screen.getByTestId("tests-tree-root-totals");
    expect(totals.textContent).toContain("1 E2E");
    expect(totals.textContent).not.toContain("Unit");
    expect(totals.textContent).not.toContain("API");
  });

  it("kind filter chips hide non-matching kinds", () => {
    mockSuccess();
    render(<TestsTreePanel projectId="demo.sln" />);
    // Turn off Unit and API — only E2E methods should remain.
    fireEvent.click(screen.getByTestId("tests-tree-filter-unit"));
    fireEvent.click(screen.getByTestId("tests-tree-filter-api"));
    expect(
      screen.queryByTestId("tests-tree-method-id::login::happy"),
    ).not.toBeNull();
    expect(
      screen.queryByTestId("tests-tree-method-id::math::add"),
    ).toBeNull();
    expect(
      screen.queryByTestId("tests-tree-method-id::api::ping"),
    ).toBeNull();
  });

  it("tri-state folder selection only operates on visible methods", () => {
    mockSuccess();
    render(<TestsTreePanel projectId="demo.sln" />);
    fireEvent.change(screen.getByTestId("tests-tree-search-input"), {
      target: { value: "happy" },
    });
    // The root checkbox now toggles only the visible matching method.
    fireEvent.click(screen.getByTestId("tests-tree-root-checkbox"));
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "1 selected",
    );
  });

  it("Run selected sends only visible-subset ids and the count reflects them", async () => {
    mockSuccess();
    mutateAsyncMock.mockResolvedValueOnce({
      runs: [],
    } satisfies RunBySelectionResponse);
    render(<TestsTreePanel projectId="demo.sln" />);
    // Pre-select two methods of different kinds.
    fireEvent.click(
      screen.getByTestId("tests-tree-method-checkbox-id::math::add"),
    );
    fireEvent.click(
      screen.getByTestId("tests-tree-method-checkbox-id::login::happy"),
    );
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "2 selected",
    );
    // Apply a search that hides the unit test but keeps the e2e one.
    fireEvent.change(screen.getByTestId("tests-tree-search-input"), {
      target: { value: "happy" },
    });
    // Visible-subset count drops to 1.
    expect(screen.getByTestId("tests-tree-selected-count").textContent).toBe(
      "1 selected",
    );
    fireEvent.click(screen.getByTestId("button-tests-tree-run-selected"));
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    const call = mutateAsyncMock.mock.calls[0][0] as {
      projectId: string;
      data: { testIds: string[] };
    };
    expect(call.data.testIds).toEqual(["id::login::happy"]);
  });

  it("shows a no-matches message when search excludes everything", () => {
    mockSuccess();
    render(<TestsTreePanel projectId="demo.sln" />);
    fireEvent.change(screen.getByTestId("tests-tree-search-input"), {
      target: { value: "no-such-test-anywhere" },
    });
    expect(screen.getByTestId("tests-tree-no-matches")).toBeDefined();
  });

  it("toasts an error when Run selected fails and does not navigate", async () => {
    mockSuccess();
    mutateAsyncMock.mockRejectedValueOnce(new Error("server is unhappy"));
    render(<TestsTreePanel projectId="demo.sln" />);
    fireEvent.click(
      screen.getByTestId("tests-tree-method-checkbox-id::math::add"),
    );
    fireEvent.click(screen.getByTestId("button-tests-tree-run-selected"));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

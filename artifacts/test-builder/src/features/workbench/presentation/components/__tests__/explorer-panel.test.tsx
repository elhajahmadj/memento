/**
 * RTL specs for <ExplorerPanel /> — the workbench Explorer's tabs shell.
 *
 * The tests cover the two-tab structure (Files / Tests) and that the
 * Files tab still renders <FileTreePanel /> with no behavior change
 * (the existing file-tree-panel.test.tsx pins the inner panel itself).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@workspace/api-client-react", () => ({
  useDiscoverProjectTests: () => ({
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
    isFetching: true,
    refetch: vi.fn(),
  }),
  useRunProjectTestsBySelection: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  getDiscoverProjectTestsQueryKey: (projectId: string) => [
    `/api/projects/${projectId}/tests`,
  ],
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/workbench", vi.fn()],
}));

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1", username: "alice", role: "admin" },
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ExplorerPanel } from "../explorer-panel";
import type { TreeNodeT } from "@/features/workbench/domain/types";

afterEach(() => cleanup());

const noop = () => {};

const tree: TreeNodeT = {
  name: "MementoDemo",
  path: ".",
  type: "folder",
  children: [{ name: "DemoTests.cs", path: "DemoTests.cs", type: "file" }],
};

describe("<ExplorerPanel />", () => {
  it("renders both Files and Tests tabs", () => {
    render(
      <ExplorerPanel
        projectId="demo.sln"
        tree={tree}
        selectedPath={null}
        onSelect={noop}
        onAddFolder={noop}
        onAddFile={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByTestId("tab-explorer-files")).toBeDefined();
    expect(screen.getByTestId("tab-explorer-tests")).toBeDefined();
  });

  it("starts on the Files tab and renders the file tree", () => {
    render(
      <ExplorerPanel
        projectId="demo.sln"
        tree={tree}
        selectedPath={null}
        onSelect={noop}
        onAddFolder={noop}
        onAddFile={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText("MementoDemo")).toBeTruthy();
  });

  it("renders a collapse button when onCollapse is provided", () => {
    const onCollapse = vi.fn();
    render(
      <ExplorerPanel
        projectId="demo.sln"
        tree={tree}
        selectedPath={null}
        onSelect={noop}
        onAddFolder={noop}
        onAddFile={noop}
        onRename={noop}
        onDelete={noop}
        onCollapse={onCollapse}
      />,
    );
    const btn = screen.getByTestId("button-collapse-explorer");
    expect(btn.getAttribute("aria-label")).toBe("Collapse Explorer");
    fireEvent.click(btn);
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("omits the collapse button when onCollapse is not provided", () => {
    render(
      <ExplorerPanel
        projectId="demo.sln"
        tree={tree}
        selectedPath={null}
        onSelect={noop}
        onAddFolder={noop}
        onAddFile={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.queryByTestId("button-collapse-explorer")).toBeNull();
  });

  it("auto-switches to the JMX files tab when a new .jmx file appears", () => {
    const { rerender } = render(
      <ExplorerPanel
        projectId="demo.sln"
        tree={tree}
        selectedPath={null}
        onSelect={noop}
        onAddFolder={noop}
        onAddFile={noop}
        onRename={noop}
        onDelete={noop}
        jmxFiles={[]}
      />,
    );
    // Initially on Files tab — the JMX panel content exists (forceMount)
    // but its containing TabsContent is inactive.
    expect(
      screen
        .getByTestId("tabpanel-explorer-tests")
        .getAttribute("data-state"),
    ).toBe("inactive");
    rerender(
      <ExplorerPanel
        projectId="demo.sln"
        tree={tree}
        selectedPath={null}
        onSelect={noop}
        onAddFolder={noop}
        onAddFile={noop}
        onRename={noop}
        onDelete={noop}
        jmxFiles={["jmx/recording-1.jmx"]}
      />,
    );
    expect(
      screen
        .getByTestId("tabpanel-explorer-tests")
        .getAttribute("data-state"),
    ).toBe("active");
    expect(
      screen.getByTestId("jmx-file-row-jmx/recording-1.jmx"),
    ).toBeTruthy();
  });

  it("switches to the Tests tab on click and reveals the tests panel", () => {
    render(
      <ExplorerPanel
        projectId="demo.sln"
        tree={tree}
        selectedPath={null}
        onSelect={noop}
        onAddFolder={noop}
        onAddFile={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByTestId("tab-explorer-tests"));
    // The Tests panel renders its loading skeleton + Run-selected toolbar
    expect(screen.getByTestId("button-tests-tree-run-selected")).toBeDefined();
    expect(screen.getByTestId("tests-tree-loading")).toBeDefined();
  });
});

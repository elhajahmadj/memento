/**
 * RTL specs for <FileTreePanel />. Pins the loading / error / populated
 * branches the workbench relies on so the Explorer never silently sits
 * on an infinite "Loading…" again (regression: the demo flow used to
 * land users in the workbench with `tree` permanently undefined when
 * `GET /projects/tree` failed).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileTreePanel } from "../file-tree-panel";
import type { TreeNodeT } from "@/features/workbench/domain/types";

afterEach(() => cleanup());

const noop = () => {};

function renderPanel(overrides: Partial<Parameters<typeof FileTreePanel>[0]> = {}) {
  return render(
    <FileTreePanel
      tree={undefined}
      selectedPath={null}
      onSelect={noop}
      onAddFolder={noop}
      onAddFile={noop}
      onRename={noop}
      onDelete={noop}
      {...overrides}
    />,
  );
}

describe("<FileTreePanel />", () => {
  it("shows the Loading… state while the tree query is in flight", () => {
    renderPanel({ isLoading: true });
    expect(screen.getByTestId("file-tree-loading").textContent).toContain(
      "Loading",
    );
    expect(screen.queryByTestId("file-tree-error")).toBeNull();
  });

  it("renders an error state with a Retry button when the tree query fails", () => {
    const onRetry = vi.fn();
    renderPanel({
      isError: true,
      error: new Error("Project directory no longer exists"),
      onRetry,
    });
    const errorBlock = screen.getByTestId("file-tree-error");
    expect(errorBlock.textContent).toContain("Couldn't load the project files.");
    expect(errorBlock.textContent).toContain(
      "Project directory no longer exists",
    );
    expect(screen.queryByTestId("file-tree-loading")).toBeNull();
    fireEvent.click(screen.getByTestId("button-file-tree-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("prefers the populated tree over loading / error states once data arrives", () => {
    const tree: TreeNodeT = {
      name: "MementoDemo",
      path: ".",
      type: "folder",
      children: [
        { name: "DemoTests.cs", path: "DemoTests.cs", type: "file" },
      ],
    };
    renderPanel({ tree, isLoading: true, isError: true });
    expect(screen.queryByTestId("file-tree-loading")).toBeNull();
    expect(screen.queryByTestId("file-tree-error")).toBeNull();
    expect(screen.getByText("MementoDemo")).toBeTruthy();
  });
});

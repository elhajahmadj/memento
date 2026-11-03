/**
 * Task #26 — JMX projects can hide / show the Captured panel and the
 * Recorded Actions side panel from the toolbar Actions dropdown.
 *
 * Mounts the real <Workbench /> page with the heavy inner components
 * stubbed so we can drive the toggle callbacks the toolbar forwards
 * to the page and verify each panel disappears from / returns to the
 * DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The workbench reads the auth context to hide AI affordances from
// guest trial sessions; these tests render it outside an AuthProvider.
vi.mock("@/features/auth/presentation/role", () => ({
  useIsGuest: () => false,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/workbench", vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/shared/ui/resizable", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ResizablePanelGroup: passthrough,
    ResizablePanel: passthrough,
    ResizableHandle: () => null,
  };
});

vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentProject: () => ({
    data: {
      project: {
        slnPath: "/tmp/demo.jmx",
        solutionName: "DemoJmx",
        solutionType: "playwright",
        language: "jmx",
        jmxFiles: [],
      },
    },
    isLoading: false,
  }),
  useGetProjectTree: () => ({
    data: { name: ".", path: ".", type: "folder", children: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useListTestClasses: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useGetRecordingStatus: () => ({ data: { phase: "idle" } }),
  useGetJmxRecordingStatus: () => ({
    data: { sessionId: "sid-1", isCapturing: false },
  }),
  getGetProjectTreeQueryKey: () => ["tree"],
  getListTestClassesQueryKey: () => ["tests"],
  getGetRecordingStatusQueryKey: () => ["status"],
  getGetJmxRecordingStatusQueryKey: () => ["jmx-status"],
}));

vi.mock("@/shared/ui/shell/footer", () => ({
  Footer: () => <div data-testid="mock-footer" />,
}));

vi.mock("@/features/onboarding/presentation/onboarding-tour", () => ({
  OnboardingTour: () => <div data-testid="mock-onboarding" />,
}));

vi.mock("../../components/code-viewer-panel", () => ({
  CodeViewerPanel: () => <div data-testid="mock-code-viewer">code</div>,
}));

vi.mock("../../components/recording-canvas", () => ({
  RecordingCanvas: () => <div data-testid="mock-recording-canvas" />,
}));

vi.mock("../../components/explorer-panel", () => ({
  ExplorerPanel: () => <div data-testid="mock-explorer" />,
}));

vi.mock("../../components/right-panel", () => ({
  RightPanel: () => <div data-testid="mock-right-panel" />,
}));

vi.mock("../../components/jmx-recording-canvas", () => ({
  JmxRecordingCanvas: (props: { capturedVisible?: boolean }) => (
    <div data-testid="mock-jmx-canvas">
      {props.capturedVisible !== false && (
        <div data-testid="mock-jmx-captured-panel" />
      )}
    </div>
  ),
}));

vi.mock("../../components/workbench-dialogs", () => ({
  WorkbenchDialogs: () => null,
}));

// Toolbar stub exposes two buttons that fire the toggle callbacks the
// real toolbar wires up via the Actions menu — that's the contract
// under test at the page level.
vi.mock("../../components/toolbar", () => ({
  Toolbar: (props: {
    onToggleJmxCaptured?: () => void;
    onToggleJmxRecorded?: () => void;
    jmxCapturedVisible?: boolean;
    jmxRecordedVisible?: boolean;
  }) => (
    <div data-testid="mock-toolbar">
      <button
        type="button"
        data-testid="toggle-captured"
        data-visible={props.jmxCapturedVisible ? "1" : "0"}
        onClick={() => props.onToggleJmxCaptured?.()}
      />
      <button
        type="button"
        data-testid="toggle-recorded"
        data-visible={props.jmxRecordedVisible ? "1" : "0"}
        onClick={() => props.onToggleJmxRecorded?.()}
      />
    </div>
  ),
}));

import { Workbench } from "../workbench";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Workbench JMX panel show/hide toggles", () => {
  it("defaults both Captured and Recorded Actions panels to visible", () => {
    render(<Workbench />);
    expect(screen.getByTestId("mock-jmx-captured-panel")).toBeTruthy();
    expect(screen.getByTestId("mock-right-panel")).toBeTruthy();
    expect(
      screen.getByTestId("toggle-captured").getAttribute("data-visible"),
    ).toBe("1");
    expect(
      screen.getByTestId("toggle-recorded").getAttribute("data-visible"),
    ).toBe("1");
  });

  it("toggling Captured removes the Captured panel and restores it on a second click", () => {
    render(<Workbench />);
    fireEvent.click(screen.getByTestId("toggle-captured"));
    expect(screen.queryByTestId("mock-jmx-captured-panel")).toBeNull();
    // The Recorded Actions side stays visible — toggles are independent.
    expect(screen.getByTestId("mock-right-panel")).toBeTruthy();
    fireEvent.click(screen.getByTestId("toggle-captured"));
    expect(screen.getByTestId("mock-jmx-captured-panel")).toBeTruthy();
  });

  it("toggling Recorded Actions removes the right panel and restores it on a second click", () => {
    render(<Workbench />);
    fireEvent.click(screen.getByTestId("toggle-recorded"));
    expect(screen.queryByTestId("mock-right-panel")).toBeNull();
    // The Captured side stays visible.
    expect(screen.getByTestId("mock-jmx-captured-panel")).toBeTruthy();
    fireEvent.click(screen.getByTestId("toggle-recorded"));
    expect(screen.getByTestId("mock-right-panel")).toBeTruthy();
  });
});

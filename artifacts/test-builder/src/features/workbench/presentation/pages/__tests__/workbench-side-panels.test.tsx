/**
 * Integration test for the Workstation's collapsible side panels (task #223).
 *
 * Mounts the real <Workbench /> page with the heavy inner components
 * stubbed so we can drive the collapse / re-open flow end-to-end and
 * verify localStorage persistence across remounts.
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

// `react-resizable-panels` needs real DOM measurements to drive its
// imperative collapse/expand API; in jsdom the size lookups throw.
// The behavior under test is the workbench-level state machine
// (which side panel is collapsed, which edge re-open control is
// rendered, what's persisted to localStorage), so a thin pass-through
// stub is sufficient here.
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
        slnPath: "/tmp/demo.sln",
        solutionName: "Demo",
        solutionType: "playwright",
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
  useGetJmxRecordingStatus: () => ({ data: null }),
  getGetProjectTreeQueryKey: () => ["tree"],
  getListTestClassesQueryKey: () => ["tests"],
  getGetRecordingStatusQueryKey: () => ["status"],
  getGetJmxRecordingStatusQueryKey: () => ["jmx-status"],
}));

vi.mock("@/shared/ui/shell/footer", () => ({
  Footer: () => <div data-testid="mock-footer" />,
}));

vi.mock(
  "@/features/workbench/presentation/components/validation-panel",
  () => ({ ValidationPanel: () => <div data-testid="mock-validation" /> }),
);

vi.mock("@/features/onboarding/presentation/onboarding-tour", () => ({
  OnboardingTour: () => <div data-testid="mock-onboarding" />,
}));

vi.mock("../../components/toolbar", () => ({
  Toolbar: () => <div data-testid="mock-toolbar" />,
}));

vi.mock("../../components/code-viewer-panel", () => ({
  CodeViewerPanel: () => <div data-testid="mock-code-viewer">code</div>,
}));

vi.mock("../../components/recording-canvas", () => ({
  RecordingCanvas: () => <div data-testid="mock-recording-canvas" />,
}));

vi.mock("../../components/explorer-panel", () => ({
  ExplorerPanel: (props: { onCollapse?: () => void }) => (
    <div data-testid="mock-explorer">
      <button
        type="button"
        data-testid="button-collapse-explorer"
        onClick={() => props.onCollapse?.()}
      >
        collapse explorer
      </button>
    </div>
  ),
}));

vi.mock("../../components/right-panel", () => ({
  RightPanel: (props: { onCollapse?: () => void }) => (
    <div data-testid="mock-right-panel">
      <button
        type="button"
        data-testid="button-collapse-test-suites"
        onClick={() => props.onCollapse?.()}
      >
        collapse test suites
      </button>
    </div>
  ),
}));

vi.mock("../../dialogs/start-recording-dialog", () => ({
  StartRecordingDialog: () => null,
}));
vi.mock("../../dialogs/build-test-dialog", () => ({
  BuildTestDialog: () => null,
}));
vi.mock("../../dialogs/add-test-class-dialog", () => ({
  AddTestClassDialog: () => null,
}));
vi.mock("../../dialogs/add-test-method-dialog", () => ({
  AddTestMethodDialog: () => null,
}));
vi.mock("../../dialogs/rename-dialog", () => ({
  RenameDialog: () => null,
}));
vi.mock("../../dialogs/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: () => null,
}));
vi.mock("../../dialogs/create-child-dialog", () => ({
  CreateChildDialog: () => null,
}));

import { Workbench } from "../workbench";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Workbench collapsible side panels", () => {
  it("starts with both side panels expanded and no edge re-open controls", () => {
    render(<Workbench />);
    expect(screen.getByTestId("mock-explorer")).toBeTruthy();
    expect(screen.getByTestId("mock-right-panel")).toBeTruthy();
    expect(screen.queryByTestId("button-expand-explorer")).toBeNull();
    expect(screen.queryByTestId("button-expand-test-suites")).toBeNull();
  });

  it("collapsing the Explorer reveals the edge re-open control and persists to localStorage", () => {
    render(<Workbench />);
    fireEvent.click(screen.getByTestId("button-collapse-explorer"));
    const reopen = screen.getByTestId("button-expand-explorer");
    expect(reopen.getAttribute("aria-label")).toBe("Show Explorer");
    expect(window.localStorage.getItem("workbench.explorer.collapsed")).toBe(
      "1",
    );
    // Test Suites side stays untouched.
    expect(screen.queryByTestId("button-expand-test-suites")).toBeNull();
    expect(
      window.localStorage.getItem("workbench.testSuites.collapsed"),
    ).toBe("0");
  });

  it("clicking the edge re-open control restores the Explorer", () => {
    render(<Workbench />);
    fireEvent.click(screen.getByTestId("button-collapse-explorer"));
    fireEvent.click(screen.getByTestId("button-expand-explorer"));
    expect(screen.queryByTestId("button-expand-explorer")).toBeNull();
    expect(window.localStorage.getItem("workbench.explorer.collapsed")).toBe(
      "0",
    );
  });

  it("collapsing the Test Suites side works independently", () => {
    render(<Workbench />);
    fireEvent.click(screen.getByTestId("button-collapse-test-suites"));
    const reopen = screen.getByTestId("button-expand-test-suites");
    expect(reopen.getAttribute("aria-label")).toBe("Show Test Suites");
    expect(
      window.localStorage.getItem("workbench.testSuites.collapsed"),
    ).toBe("1");
    expect(screen.queryByTestId("button-expand-explorer")).toBeNull();
  });

  it("pins the Test Suites re-open control to the right edge with a left-pointing chevron", () => {
    render(<Workbench />);
    fireEvent.click(screen.getByTestId("button-collapse-test-suites"));
    const reopen = screen.getByTestId("button-expand-test-suites");
    // Positioning lives on the wrapper, not the Button — the shared
    // Button component applies `hover-elevate`, which forces
    // `position: relative` and would override `absolute` on the button
    // itself, pushing the re-open control off-screen below the panel
    // group. Wrapping in a positioned <div> is the fix.
    const wrapper = reopen.parentElement;
    expect(wrapper).not.toBeNull();
    const cls = wrapper!.className;
    expect(cls).toContain("absolute");
    expect(cls).toContain("right-0");
    expect(cls).toContain("top-1/2");
    expect(cls).toContain("-translate-y-1/2");
    expect(cls).toMatch(/\bz-(20|30|40|50)\b/);
    // Regression guard: positioning must NOT be on the Button itself —
    // `hover-elevate` would override `position: absolute`.
    expect(reopen.className).not.toContain("absolute");
    // Chevron points left so it visually reads as "open panel toward
    // the left", mirroring the Explorer's right-pointing chevron.
    const svg = reopen.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains("lucide-chevrons-left")).toBe(true);
  });

  it("pins the Explorer re-open control to the left edge with a right-pointing chevron", () => {
    render(<Workbench />);
    fireEvent.click(screen.getByTestId("button-collapse-explorer"));
    const reopen = screen.getByTestId("button-expand-explorer");
    const wrapper = reopen.parentElement;
    expect(wrapper).not.toBeNull();
    const cls = wrapper!.className;
    expect(cls).toContain("absolute");
    expect(cls).toContain("left-0");
    expect(cls).toContain("top-1/2");
    expect(cls).toContain("-translate-y-1/2");
    const svg = reopen.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains("lucide-chevrons-right")).toBe(true);
  });

  it("re-opens the Test Suites panel when the right-edge control is clicked", () => {
    window.localStorage.setItem("workbench.testSuites.collapsed", "1");
    render(<Workbench />);
    expect(screen.getByTestId("button-expand-test-suites")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-expand-test-suites"));
    expect(screen.queryByTestId("button-expand-test-suites")).toBeNull();
    expect(
      window.localStorage.getItem("workbench.testSuites.collapsed"),
    ).toBe("0");
  });

  it("reads persisted collapsed state on mount and shows the re-open controls immediately", () => {
    window.localStorage.setItem("workbench.explorer.collapsed", "1");
    window.localStorage.setItem("workbench.testSuites.collapsed", "1");
    render(<Workbench />);
    expect(screen.getByTestId("button-expand-explorer")).toBeTruthy();
    expect(screen.getByTestId("button-expand-test-suites")).toBeTruthy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/shared/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children);
  const Item = ({
    children,
    onClick,
    disabled,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement(
      "button",
      { type: "button", onClick, disabled, ...rest },
      children,
    );
  const Trigger = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuTrigger: Trigger,
    DropdownMenuItem: Item,
  };
});

import { WorkbenchActionsMenu } from "../workbench-actions-menu";

const baseProps = {
  isApi: false,
  language: "csharp" as const,
  isExporting: false,
  onValidate: vi.fn(),
  onExport: vi.fn(),
  onOpenPipelineDialog: vi.fn(),
};

beforeEach(() => {
  baseProps.onValidate.mockReset();
  baseProps.onExport.mockReset();
  baseProps.onOpenPipelineDialog.mockReset();
});

afterEach(() => cleanup());

describe("<WorkbenchActionsMenu />", () => {
  it("renders the trigger and three items for non-API projects and wires their handlers", async () => {
    render(<WorkbenchActionsMenu {...baseProps} />);
    expect(screen.getByTestId("button-workbench-actions-menu")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-open-validation"));
    });
    expect(baseProps.onValidate).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-download-zip"));
    });
    expect(baseProps.onExport).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-generate-pipeline-file"));
    });
    expect(baseProps.onOpenPipelineDialog).toHaveBeenCalledTimes(1);
  });

  it("hides Validate and Generate Pipeline File for API projects but keeps Export", () => {
    render(<WorkbenchActionsMenu {...baseProps} isApi />);
    expect(screen.queryByTestId("button-open-validation")).toBeNull();
    expect(screen.queryByTestId("button-generate-pipeline-file")).toBeNull();
    expect(screen.getByTestId("button-download-zip")).toBeTruthy();
  });

  it("hides Validate and Generate Pipeline File for JMX projects but keeps Export", () => {
    render(<WorkbenchActionsMenu {...baseProps} language="jmx" />);
    expect(screen.queryByTestId("button-open-validation")).toBeNull();
    expect(screen.queryByTestId("button-generate-pipeline-file")).toBeNull();
    expect(screen.getByTestId("button-download-zip")).toBeTruthy();
  });

  it("disables the Export item while an export is in flight", () => {
    render(<WorkbenchActionsMenu {...baseProps} isExporting />);
    const exportItem = screen.getByTestId("button-download-zip");
    expect((exportItem as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not show JMX captured/recorded toggles for non-JMX projects", () => {
    const onToggleJmxCaptured = vi.fn();
    const onToggleJmxRecorded = vi.fn();
    render(
      <WorkbenchActionsMenu
        {...baseProps}
        jmxCapturedVisible
        jmxRecordedVisible
        onToggleJmxCaptured={onToggleJmxCaptured}
        onToggleJmxRecorded={onToggleJmxRecorded}
      />,
    );
    expect(screen.queryByTestId("button-toggle-jmx-captured")).toBeNull();
    expect(screen.queryByTestId("button-toggle-jmx-recorded")).toBeNull();
  });

  it("shows JMX toggle items with flipping labels for JMX projects and wires their callbacks", async () => {
    const onToggleJmxCaptured = vi.fn();
    const onToggleJmxRecorded = vi.fn();
    const { rerender } = render(
      <WorkbenchActionsMenu
        {...baseProps}
        language="jmx"
        jmxCapturedVisible
        jmxRecordedVisible
        onToggleJmxCaptured={onToggleJmxCaptured}
        onToggleJmxRecorded={onToggleJmxRecorded}
      />,
    );

    const captured = screen.getByTestId("button-toggle-jmx-captured");
    const recorded = screen.getByTestId("button-toggle-jmx-recorded");
    expect(captured.textContent).toContain("Hide captured");
    expect(recorded.textContent).toContain("Hide recorded actions");

    await act(async () => {
      fireEvent.click(captured);
    });
    expect(onToggleJmxCaptured).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(recorded);
    });
    expect(onToggleJmxRecorded).toHaveBeenCalledTimes(1);

    rerender(
      <WorkbenchActionsMenu
        {...baseProps}
        language="jmx"
        jmxCapturedVisible={false}
        jmxRecordedVisible={false}
        onToggleJmxCaptured={onToggleJmxCaptured}
        onToggleJmxRecorded={onToggleJmxRecorded}
      />,
    );
    expect(
      screen.getByTestId("button-toggle-jmx-captured").textContent,
    ).toContain("Show captured");
    expect(
      screen.getByTestId("button-toggle-jmx-recorded").textContent,
    ).toContain("Show recorded actions");
  });

  it("omits the JMX toggles when their callbacks are not provided even for JMX projects", () => {
    render(<WorkbenchActionsMenu {...baseProps} language="jmx" />);
    expect(screen.queryByTestId("button-toggle-jmx-captured")).toBeNull();
    expect(screen.queryByTestId("button-toggle-jmx-recorded")).toBeNull();
  });
});

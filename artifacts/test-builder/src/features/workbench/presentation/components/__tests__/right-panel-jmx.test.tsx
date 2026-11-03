/**
 * Task #14 — JMX projects hide all Validate affordances in the right
 * panel: the per-class / per-method inline buttons in Test Suites and
 * the "Validate" button in the Recorded Actions toolbar. Non-JMX
 * projects keep them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      {
        kind: "testMethod",
        filePath: "/tests/Foo.cs",
        methodName: "DoesAThing",
      },
    ],
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  listValidationRecordings: vi.fn(),
}));

vi.mock("../actions-feed", () => ({
  ActionsFeed: () => <div data-testid="mock-actions-feed" />,
}));

vi.mock("../test-body-preview", () => ({
  TestBodyPreview: () => <div data-testid="mock-body-preview" />,
}));

vi.mock("../history-panel", () => ({
  HistoryPanel: () => <div data-testid="mock-history" />,
}));

vi.mock("../right-panel/right-panel-dialogs", () => ({
  RightPanelDialogs: () => null,
}));

import { RightPanel } from "../right-panel";

const baseProps = {
  tests: [{ className: "Foo", path: "/tests/Foo.cs" }],
  onAddClass: vi.fn(),
  onAddMethod: vi.fn(),
  onValidateClass: vi.fn(),
  onValidateMethod: vi.fn(),
  onValidateSession: vi.fn(),
  recording: false,
  stopped: true,
};

afterEach(() => cleanup());

describe("<RightPanel /> JMX gating", () => {
  it("renders all Validate buttons for non-JMX projects", () => {
    render(<RightPanel {...baseProps} />);
    expect(screen.getByTestId("button-validate-class-Foo")).toBeTruthy();
    expect(
      screen.getByTestId("button-validate-method-Foo-DoesAThing"),
    ).toBeTruthy();
    expect(screen.getByTestId("button-validate-session")).toBeTruthy();
  });

  it("hides every Validate affordance when isJmx is true", () => {
    render(<RightPanel {...baseProps} isJmx />);
    expect(screen.queryByTestId("button-validate-class-Foo")).toBeNull();
    expect(
      screen.queryByTestId("button-validate-method-Foo-DoesAThing"),
    ).toBeNull();
    expect(screen.queryByTestId("button-validate-session")).toBeNull();
    // The other stopped-state buttons must still appear.
    expect(screen.getByTestId("button-add-assertion")).toBeTruthy();
    expect(screen.getByTestId("button-add-api-check")).toBeTruthy();
    expect(screen.getByTestId("button-add-wait")).toBeTruthy();
  });
});

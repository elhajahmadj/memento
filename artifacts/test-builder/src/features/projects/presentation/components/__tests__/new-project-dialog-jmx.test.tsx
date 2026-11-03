import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useListArchitectures: () => ({ data: [] }),
    useListRepoPats: () => ({ data: [], isLoading: false }),
  };
});

import { JmxBuilderForm } from "../new-project-dialog";

function renderForm(onCreate: (input: unknown) => void) {
  return render(
    <JmxBuilderForm
      onCreate={onCreate}
      creating={false}
      onCancel={() => {}}
      resetSignal={0}
    />,
  );
}

afterEach(() => cleanup());

describe("<JmxBuilderForm /> — BFF checkbox", () => {
  it("renders the BFF checkbox alongside Use JWT auth", () => {
    renderForm(() => {});
    expect(screen.getByTestId("checkbox-jmx-jwt-auth")).toBeTruthy();
    expect(screen.getByTestId("checkbox-jmx-bff")).toBeTruthy();
    expect(
      screen.getByText(/BFF \(Backend-for-Frontend\) auth/i),
    ).toBeTruthy();
  });

  it("submits bff=false by default", () => {
    const onCreate = vi.fn();
    renderForm(onCreate);
    fireEvent.change(screen.getByTestId("input-jmx-name"), {
      target: { value: "MyPlan" },
    });
    fireEvent.change(screen.getByTestId("input-jmx-target-url"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByTestId("button-create-jmx-project"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      solutionName: "MyPlan",
      language: "jmx",
      jwtAuth: false,
      bff: false,
    });
    expect(onCreate.mock.calls[0][0].targetUrl).toMatch(/^https:\/\/example\.com/);
  });

  it("submits bff=true when the checkbox is toggled on", () => {
    const onCreate = vi.fn();
    renderForm(onCreate);
    fireEvent.change(screen.getByTestId("input-jmx-name"), {
      target: { value: "BffPlan" },
    });
    fireEvent.change(screen.getByTestId("input-jmx-target-url"), {
      target: { value: "https://bff.example.com" },
    });
    fireEvent.click(screen.getByTestId("checkbox-jmx-bff"));
    fireEvent.click(screen.getByTestId("button-create-jmx-project"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      solutionName: "BffPlan",
      language: "jmx",
      bff: true,
    });
  });
});

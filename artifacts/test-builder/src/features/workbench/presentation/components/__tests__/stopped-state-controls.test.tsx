import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoppedStateControls } from "../toolbar/stopped-state-controls";

/**
 * What the toolbar offers after "Stop recording".
 *
 * The distinction is NOT admin-vs-everyone-else: it is "does this user's
 * recording go straight into the project, or through SDET review?".
 * Guests save directly — a guest trial is solo and disposable, there is
 * no reviewer, and they own no fork to submit from, so the approval path
 * would fail server-side with "you do not have an active fork".
 */
afterEach(cleanup);

function renderControls(overrides: Partial<Parameters<typeof StoppedStateControls>[0]> = {}) {
  const props = {
    canSaveDirectly: false,
    finalizePending: false,
    pendingApproval: false,
    onDiscard: vi.fn(),
    onSave: vi.fn(),
    onSubmitForApproval: vi.fn(),
    ...overrides,
  };
  render(<StoppedStateControls {...props} />);
  return props;
}

describe("<StoppedStateControls />", () => {
  it("offers Save and no approval button when the user saves directly", () => {
    renderControls({ canSaveDirectly: true });
    expect(screen.getByTestId("button-save-recording")).toBeDefined();
    expect(screen.queryByTestId("button-request-approval")).toBeNull();
  });

  it("offers the approval button to reviewers-required users", () => {
    renderControls({ canSaveDirectly: false });
    expect(screen.getByTestId("button-request-approval")).toBeDefined();
    expect(screen.queryByTestId("button-save-recording")).toBeNull();
  });

  it("calls onSave — not onSubmitForApproval — for direct savers", () => {
    const props = renderControls({ canSaveDirectly: true });
    fireEvent.click(screen.getByTestId("button-save-recording"));
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onSubmitForApproval).not.toHaveBeenCalled();
  });

  it("always offers Discard", () => {
    const props = renderControls({ canSaveDirectly: true });
    fireEvent.click(screen.getByTestId("button-discard-recording"));
    expect(props.onDiscard).toHaveBeenCalledOnce();
  });

  it("never disables Save on a pending approval", () => {
    // `pendingApproval` is about someone else's review queue and is
    // meaningless for a direct saver — it must not gate their Save.
    renderControls({ canSaveDirectly: true, pendingApproval: true });
    const save = screen.getByTestId("button-save-recording") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it("disables the approval button while one is already pending", () => {
    renderControls({ canSaveDirectly: false, pendingApproval: true });
    const btn = screen.getByTestId("button-request-approval") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/Approval pending/i);
  });

  it("disables the active button while a finalize is in flight", () => {
    renderControls({ canSaveDirectly: true, finalizePending: true });
    expect(
      (screen.getByTestId("button-save-recording") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

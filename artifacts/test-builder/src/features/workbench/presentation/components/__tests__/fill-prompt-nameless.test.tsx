import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FillPromptDialog } from "../recording-canvas/fill-prompt-dialog";
import type { FillPromptState } from "../recording-canvas/types";

/**
 * Value-only ("nameless") mode of the fill dialog.
 *
 * Used while browsing an open-browser session that has not been
 * attached yet: the user needs to type into fields to get the page into
 * the state they want to record from (log in, search, dismiss a form),
 * but none of it is recorded — so there is no action to name.
 */
afterEach(cleanup);

function renderDialog(
  prompt: FillPromptState | null,
  overrides: { nameValue?: string; onSubmit?: () => void } = {},
) {
  const onSubmit = overrides.onSubmit ?? vi.fn();
  render(
    <FillPromptDialog
      prompt={prompt}
      value="hunter2"
      onValueChange={vi.fn()}
      nameValue={overrides.nameValue ?? ""}
      onNameValueChange={vi.fn()}
      language="csharp"
      onCancel={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

const namelessPrompt: FillPromptState = {
  label: "Username",
  kind: "input",
  selector: "#username",
  nameless: true,
};

const recordingPrompt: FillPromptState = {
  label: "Username",
  kind: "input",
  selector: "#username",
};

describe("FillPromptDialog — value-only mode", () => {
  it("hides the action-name field", () => {
    renderDialog(namelessPrompt);
    const name = screen.getByTestId("input-fill-method-name");
    // Present in the DOM but inside a hidden, aria-hidden container.
    expect(name.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("still shows the name field when recording", () => {
    renderDialog(recordingPrompt);
    const name = screen.getByTestId("input-fill-method-name");
    expect(name.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("labels the submit button for typing, not filling", () => {
    renderDialog(namelessPrompt);
    expect(screen.getByTestId("button-fill-submit").textContent).toMatch(
      /Type into field/i,
    );
  });

  it("submits even when a stale invalid name is carried over", () => {
    // The name input is hidden here, so a leftover invalid value from a
    // previous prompt must not silently block the button.
    const { onSubmit } = renderDialog(namelessPrompt, {
      nameValue: "9 not an identifier",
    });
    const btn = screen.getByTestId("button-fill-submit") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("still blocks an invalid name while recording", () => {
    const { onSubmit } = renderDialog(recordingPrompt, {
      nameValue: "9 not an identifier",
    });
    const btn = screen.getByTestId("button-fill-submit") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still asks for the value", () => {
    renderDialog(namelessPrompt);
    expect(screen.getByTestId("input-fill-value")).toBeDefined();
  });
});

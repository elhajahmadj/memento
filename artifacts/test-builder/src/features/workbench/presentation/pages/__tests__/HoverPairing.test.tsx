import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActionsFeed, TestBodyPreview } from "../workbench";

function broadcastPreview(
  lines: string[],
  lineActionIndices: Array<number | null>,
) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("recorder:body-preview", {
        detail: { lines, lineActionIndices },
      }),
    );
  });
}

function broadcastAction(action: {
  type: string;
  index: number;
  selector?: string;
  strategy?: string;
  suggestedMethodName?: string;
}) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("recorder:action", { detail: action }),
    );
  });
}

function broadcastDeleted(index: number) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("recorder:action-deleted", { detail: { index } }),
    );
  });
}

function broadcastNamed(index: number, methodName: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("recorder:action-named", {
        detail: { index, methodName },
      }),
    );
  });
}

function resetFeed() {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("recorder:action", { detail: "reset" }),
    );
  });
}

function previewLineHighlighted(el: HTMLElement | null): boolean {
  if (!el) return false;
  const bg = (el.style.background || el.style.backgroundColor || "").trim();
  return bg.length > 0 && bg !== "transparent";
}

function feedRowHighlighted(el: HTMLElement | null): boolean {
  if (!el) return false;
  return el.className.includes("border-primary");
}

describe("hover-to-link pairing between ActionsFeed and TestBodyPreview", () => {
  afterEach(() => {
    cleanup();
    // Clear any sticky state on the window event bus between tests.
    broadcastPreview([], []);
    resetFeed();
  });

  it("hovering a feed row highlights the matching preview line, and vice versa", () => {
    render(
      <>
        <ActionsFeed />
        <TestBodyPreview />
      </>,
    );

    broadcastAction({
      type: "click",
      index: 0,
      strategy: "ById",
      suggestedMethodName: "ClickSubmit",
    });
    broadcastAction({
      type: "fill",
      index: 1,
      strategy: "ByName",
      suggestedMethodName: "FillEmail",
    });

    const lines = [
      "// arrange",
      "await Selectors.SubmitButton.ClickAsync();",
      "await Selectors.EmailField.FillAsync(\"hi@example.com\");",
    ];
    // First line is a setup/comment line (null), then one line per action.
    broadcastPreview(lines, [null, 0, 1]);

    const row0 = screen.getByTestId("action-feed-item-0") as HTMLElement;
    const row1 = screen.getByTestId("action-feed-item-1") as HTMLElement;
    const previewLine0 = screen.getByTestId(
      "preview-line-action-0",
    ) as HTMLElement;
    const previewLine1 = screen.getByTestId(
      "preview-line-action-1",
    ) as HTMLElement;
    const setupLine = screen.getByTestId(
      "preview-line-setup-0",
    ) as HTMLElement;

    // Nothing is highlighted at rest.
    expect(previewLineHighlighted(previewLine0)).toBe(false);
    expect(previewLineHighlighted(previewLine1)).toBe(false);
    expect(feedRowHighlighted(row0)).toBe(false);
    expect(feedRowHighlighted(row1)).toBe(false);

    // Hover feed row 0 → preview line for action 0 highlights, and only it.
    act(() => {
      fireEvent.mouseEnter(row0);
    });
    expect(previewLineHighlighted(previewLine0)).toBe(true);
    expect(previewLineHighlighted(previewLine1)).toBe(false);
    expect(previewLineHighlighted(setupLine)).toBe(false);
    // The originating row reflects the same hover state.
    expect(feedRowHighlighted(row0)).toBe(true);
    expect(feedRowHighlighted(row1)).toBe(false);

    act(() => {
      fireEvent.mouseLeave(row0);
    });
    expect(previewLineHighlighted(previewLine0)).toBe(false);
    expect(feedRowHighlighted(row0)).toBe(false);

    // Hover preview line for action 1 → feed row 1 highlights, and only it.
    act(() => {
      fireEvent.mouseEnter(previewLine1);
    });
    expect(feedRowHighlighted(row1)).toBe(true);
    expect(feedRowHighlighted(row0)).toBe(false);
    expect(previewLineHighlighted(previewLine1)).toBe(true);
    expect(previewLineHighlighted(previewLine0)).toBe(false);

    act(() => {
      fireEvent.mouseLeave(previewLine1);
    });
    expect(feedRowHighlighted(row1)).toBe(false);
    expect(previewLineHighlighted(previewLine1)).toBe(false);

    // Setup lines have no associated action and must not dispatch a hover
    // (so feed rows stay calm when the user hovers them).
    act(() => {
      fireEvent.mouseEnter(setupLine);
    });
    expect(feedRowHighlighted(row0)).toBe(false);
    expect(feedRowHighlighted(row1)).toBe(false);
  });

  it("deleting an action removes its preview line and stops highlighting on hover", () => {
    render(
      <>
        <ActionsFeed />
        <TestBodyPreview />
      </>,
    );

    broadcastAction({
      type: "click",
      index: 0,
      strategy: "ById",
      suggestedMethodName: "ClickSubmit",
    });
    broadcastAction({
      type: "fill",
      index: 1,
      strategy: "ByName",
      suggestedMethodName: "FillEmail",
    });
    broadcastPreview(
      [
        "await Selectors.SubmitButton.ClickAsync();",
        "await Selectors.EmailField.FillAsync(\"hi@example.com\");",
      ],
      [0, 1],
    );

    expect(screen.getByTestId("preview-line-action-0")).toBeDefined();
    expect(screen.getByTestId("preview-line-action-1")).toBeDefined();

    // Server emits the deletion + a fresh body-preview without the deleted line.
    broadcastDeleted(0);
    broadcastPreview(
      ["await Selectors.EmailField.FillAsync(\"hi@example.com\");"],
      [1],
    );

    // The deleted action's preview line is gone.
    expect(screen.queryByTestId("preview-line-action-0")).toBeNull();
    // Surviving line still renders.
    const survivingLine = screen.getByTestId(
      "preview-line-action-1",
    ) as HTMLElement;
    expect(survivingLine).toBeDefined();
    // The deleted action's feed row is gone.
    expect(screen.queryByTestId("action-feed-item-0")).toBeNull();
    const survivingRow = screen.getByTestId(
      "action-feed-item-1",
    ) as HTMLElement;

    // Simulate a stale hover for the deleted action: nothing should highlight,
    // since neither component has an element bound to index 0 anymore.
    act(() => {
      window.dispatchEvent(
        new CustomEvent("recorder:hover-action", { detail: { index: 0 } }),
      );
    });
    expect(previewLineHighlighted(survivingLine)).toBe(false);
    expect(feedRowHighlighted(survivingRow)).toBe(false);

    // Sanity: the surviving pair still links up correctly.
    act(() => {
      fireEvent.mouseEnter(survivingRow);
    });
    expect(previewLineHighlighted(survivingLine)).toBe(true);
    act(() => {
      fireEvent.mouseLeave(survivingRow);
    });
    expect(previewLineHighlighted(survivingLine)).toBe(false);
  });

  it("renaming an action keeps hover pairing intact with refreshed preview lines", () => {
    render(
      <>
        <ActionsFeed />
        <TestBodyPreview />
      </>,
    );

    broadcastAction({
      type: "click",
      index: 0,
      strategy: "ById",
      suggestedMethodName: "ClickSubmit",
    });
    broadcastAction({
      type: "fill",
      index: 1,
      strategy: "ByName",
      suggestedMethodName: "FillEmail",
    });

    const initialLines = [
      "await Selectors.SubmitButton.ClickAsync();",
      "await Selectors.EmailField.FillAsync(\"hi@example.com\");",
    ];
    broadcastPreview(initialLines, [0, 1]);

    const initialLine1Text = (
      screen.getByTestId("preview-line-action-1") as HTMLElement
    ).textContent;

    // User accepts a new name for the second action; server rebroadcasts the
    // body preview with updated text but the same line→action mapping.
    broadcastNamed(1, "SubmitLoginForm");
    const renamedLines = [
      "await Selectors.SubmitButton.ClickAsync();",
      "await Selectors.EmailField.SubmitLoginFormAsync(\"hi@example.com\");",
    ];
    broadcastPreview(renamedLines, [0, 1]);

    const row1 = screen.getByTestId("action-feed-item-1") as HTMLElement;
    const row0 = screen.getByTestId("action-feed-item-0") as HTMLElement;
    const previewLine1 = screen.getByTestId(
      "preview-line-action-1",
    ) as HTMLElement;
    const previewLine0 = screen.getByTestId(
      "preview-line-action-0",
    ) as HTMLElement;

    // The renamed action's display label and its preview line both reflect
    // the new name (so this isn't a no-op rename that would silently pass).
    const renamedLabel = screen.getByTestId(
      "action-method-name-1",
    ) as HTMLElement;
    expect(renamedLabel.textContent).toContain("SubmitLoginForm");
    expect(previewLine1.textContent).not.toBe(initialLine1Text);
    expect(previewLine1.textContent).toContain("SubmitLoginForm");

    // Hover the renamed feed row → only its (refreshed) preview line lights up.
    act(() => {
      fireEvent.mouseEnter(row1);
    });
    expect(previewLineHighlighted(previewLine1)).toBe(true);
    expect(previewLineHighlighted(previewLine0)).toBe(false);
    expect(feedRowHighlighted(row1)).toBe(true);
    expect(feedRowHighlighted(row0)).toBe(false);
    act(() => {
      fireEvent.mouseLeave(row1);
    });
    expect(previewLineHighlighted(previewLine1)).toBe(false);
    expect(feedRowHighlighted(row1)).toBe(false);

    // And vice versa: hovering the refreshed preview line highlights the
    // renamed feed row, not the other one.
    act(() => {
      fireEvent.mouseEnter(previewLine1);
    });
    expect(feedRowHighlighted(row1)).toBe(true);
    expect(feedRowHighlighted(row0)).toBe(false);
    expect(previewLineHighlighted(previewLine1)).toBe(true);
    expect(previewLineHighlighted(previewLine0)).toBe(false);
    act(() => {
      fireEvent.mouseLeave(previewLine1);
    });
    expect(feedRowHighlighted(row1)).toBe(false);
    expect(previewLineHighlighted(previewLine1)).toBe(false);

    // The unrenamed sibling's pairing still works too.
    act(() => {
      fireEvent.mouseEnter(row0);
    });
    expect(previewLineHighlighted(previewLine0)).toBe(true);
    expect(previewLineHighlighted(previewLine1)).toBe(false);
    act(() => {
      fireEvent.mouseLeave(row0);
    });
  });
});

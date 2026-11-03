import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActionsFeed, TestBodyPreview } from "../workbench";

interface RecordedActionLike {
  type: string;
  index: number;
  selector?: string;
  strategy?: string;
}

function pushAction(action: RecordedActionLike) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("recorder:action", { detail: action }),
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

function broadcastBodyPreview(
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

function flushPendingScroll() {
  // The preview defers scrolling to a useEffect after re-render; trigger
  // an extra render cycle so the effect has run before assertions.
  act(() => {
    window.dispatchEvent(
      new CustomEvent("recorder:hover-action", { detail: { index: null } }),
    );
  });
}

describe("click-to-jump linking between preview and feed", () => {
  let scrollSpy: ReturnType<typeof vi.fn>;
  let scrolledElements: Element[];
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scrolledElements = [];
    scrollSpy = vi.fn(function (this: Element) {
      scrolledElements.push(this);
    });
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
    // Run rAF callbacks synchronously so feed-side scroll is observable.
    rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
  });

  afterEach(() => {
    cleanup();
    resetFeed();
    broadcastBodyPreview([], []);
    Element.prototype.scrollIntoView = originalScrollIntoView;
    rafSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function setupPanes() {
    render(
      <div>
        <ActionsFeed />
        <TestBodyPreview />
      </div>,
    );

    // Five recorded actions, indices 0..4.
    for (let i = 0; i < 5; i++) {
      pushAction({
        type: "click",
        index: i,
        selector: `#btn-${i}`,
        strategy: "id",
      });
    }

    // Body preview: two setup lines (no action), then one line per action.
    const lines = [
      "// setup line A",
      "// setup line B",
      "await Selectors.Btn0.ClickAsync();",
      "await Selectors.Btn1.ClickAsync();",
      "await Selectors.Btn2.ClickAsync();",
      "await Selectors.Btn3.ClickAsync();",
      "await Selectors.Btn4.ClickAsync();",
    ];
    const lineActionIndices: Array<number | null> = [
      null,
      null,
      0,
      1,
      2,
      3,
      4,
    ];
    broadcastBodyPreview(lines, lineActionIndices);
  }

  it("clicking a preview line scrolls the feed row into view and focuses it", () => {
    setupPanes();

    // Sanity: target feed row is rendered but not yet focused.
    const targetRow = screen.getByTestId("action-feed-item-3");
    expect(targetRow.className).not.toMatch(/ring-2/);

    // Click the preview line whose action index is 3.
    const previewLine = screen.getByTestId("preview-line-action-3");
    scrolledElements.length = 0;
    fireEvent.click(previewLine);

    // Feed scrolled the matching row into view (via requestAnimationFrame).
    expect(scrolledElements).toContain(targetRow);

    // The matched row gained the focused outline class.
    expect(targetRow.className).toMatch(/ring-2/);
    expect(targetRow.className).toMatch(/border-primary/);

    // Other rows are not focused.
    expect(
      screen.getByTestId("action-feed-item-0").className,
    ).not.toMatch(/ring-2/);
  });

  it("clicking a feed row scrolls the preview line into view and focuses it", () => {
    setupPanes();

    const targetLine = screen.getByTestId("preview-line-action-1");
    // No focused outline yet (transparent border-left).
    expect((targetLine as HTMLElement).style.borderLeft).toContain(
      "transparent",
    );

    scrolledElements.length = 0;
    fireEvent.click(screen.getByTestId("action-feed-item-1"));
    flushPendingScroll();

    // The preview scrolled the matching line into view.
    expect(scrolledElements).toContain(targetLine);

    // The focused preview line now has the indigo outline.
    expect((targetLine as HTMLElement).style.borderLeft).not.toContain(
      "transparent",
    );
    expect((targetLine as HTMLElement).style.borderLeft).toMatch(/solid/);
  });

  it("clicking a setup preview line (no matching action) does nothing", () => {
    setupPanes();

    // Capture pre-click focus state of every feed row.
    const beforeClasses = Array.from({ length: 5 }, (_, i) =>
      screen.getByTestId(`action-feed-item-${i}`).className,
    );

    scrolledElements.length = 0;
    const setupLine = screen.getByTestId("preview-line-setup-0");
    fireEvent.click(setupLine);

    // No scroll fired for any feed row or preview line.
    expect(scrolledElements).toHaveLength(0);

    // No feed row became focused.
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`action-feed-item-${i}`).className).toBe(
        beforeClasses[i],
      );
    }

    // No preview action line picked up the focused outline either.
    for (let i = 0; i < 5; i++) {
      const line = screen.getByTestId(`preview-line-action-${i}`) as HTMLElement;
      expect(line.style.borderLeft).toContain("transparent");
    }
  });
});

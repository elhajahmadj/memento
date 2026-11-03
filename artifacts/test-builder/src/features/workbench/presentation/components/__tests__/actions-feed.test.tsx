/**
 * RTL specs for <ActionsFeed />. The component is a pure event-bus
 * surface — it listens for `recorder:*` events to populate / mutate
 * its row list, and dispatches `recorder:request-*` events when the
 * user clicks per-row controls. We exercise both directions:
 *
 *   - dispatch a few `recorder:action` events and assert the rows
 *     render with the expected per-index test ids
 *   - click move-up / move-down / duplicate / insert-before / delete /
 *     bulk-delete controls and assert the matching `recorder:request-*`
 *     event fires with the right payload
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("react-syntax-highlighter", () => ({
  Prism: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
  createElement: () => null,
}));

vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  vscDarkPlus: {},
}));

import { ActionsFeed } from "../actions-feed";

function emitAction(payload: Record<string, unknown>): void {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("recorder:action", { detail: payload }),
    );
  });
}

function captureEvent(name: string): { calls: CustomEvent[]; remove: () => void } {
  const calls: CustomEvent[] = [];
  const handler = (e: Event) => {
    calls.push(e as CustomEvent);
  };
  window.addEventListener(name, handler as EventListener);
  return {
    calls,
    remove: () => window.removeEventListener(name, handler as EventListener),
  };
}

beforeEach(() => {
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  // Reset the feed between tests so leftover items from one test
  // can't leak into the next via the global event bus.
  act(() => {
    window.dispatchEvent(
      new CustomEvent("recorder:feed-reset", { detail: { items: [] } }),
    );
  });
});

afterEach(() => {
  cleanup();
});

interface ToastAction {
  label: string;
  onClick: () => void;
}
function lastToastAction(): ToastAction {
  const last = toastSuccessMock.mock.calls.at(-1);
  if (!last) throw new Error("toast.success was never called");
  const opts = last[1] as { action?: ToastAction } | undefined;
  if (!opts?.action) throw new Error("toast.success was called without an action");
  return opts.action;
}

describe("<ActionsFeed /> rendering", () => {
  it("renders one row per `recorder:action` event keyed by server-assigned index", () => {
    render(<ActionsFeed />);
    emitAction({
      type: "click",
      selector: '[data-testid="alpha"]',
      index: 0,
    });
    emitAction({
      type: "click",
      selector: '[data-testid="beta"]',
      index: 1,
    });
    expect(screen.getByTestId("action-feed-item-0")).toBeDefined();
    expect(screen.getByTestId("action-feed-item-1")).toBeDefined();
  });

  it("renders the toolbar (with Select all + Delete) only after at least one action arrives", () => {
    render(<ActionsFeed />);
    expect(screen.queryByTestId("actions-feed-toolbar")).toBeNull();
    emitAction({
      type: "click",
      selector: '[data-testid="alpha"]',
      index: 0,
    });
    expect(screen.getByTestId("actions-feed-toolbar")).toBeDefined();
  });
});

describe("<ActionsFeed /> per-row mutation buttons dispatch recorder:request-* events", () => {
  beforeEach(() => {
    render(<ActionsFeed />);
    emitAction({
      type: "click",
      selector: '[data-testid="alpha"]',
      index: 0,
    });
    emitAction({
      type: "click",
      selector: '[data-testid="beta"]',
      index: 1,
    });
    emitAction({
      type: "click",
      selector: '[data-testid="gamma"]',
      index: 2,
    });
  });

  it("move-down on row 0 dispatches recorder:request-move-action {index:0, direction:'down'}", () => {
    const cap = captureEvent("recorder:request-move-action");
    fireEvent.click(screen.getByTestId("button-move-down-action-0"));
    expect(cap.calls.length).toBeGreaterThanOrEqual(1);
    expect(cap.calls[0]!.detail).toMatchObject({
      index: 0,
      direction: "down",
    });
    cap.remove();
  });

  it("move-up on row 1 dispatches recorder:request-move-action {index:1, direction:'up'}", () => {
    const cap = captureEvent("recorder:request-move-action");
    fireEvent.click(screen.getByTestId("button-move-up-action-1"));
    expect(cap.calls[0]!.detail).toMatchObject({
      index: 1,
      direction: "up",
    });
    cap.remove();
  });

  it("duplicate on row 1 dispatches recorder:request-duplicate-action {index:1}", () => {
    const cap = captureEvent("recorder:request-duplicate-action");
    fireEvent.click(screen.getByTestId("button-duplicate-action-1"));
    expect(cap.calls[0]!.detail).toMatchObject({ index: 1 });
    cap.remove();
  });

  it("insert-before on row 2 dispatches recorder:request-open-add-assertion {insertBeforeIndex:2}", () => {
    const cap = captureEvent("recorder:request-open-add-assertion");
    fireEvent.click(screen.getByTestId("button-insert-before-action-2"));
    expect(cap.calls[0]!.detail).toMatchObject({ insertBeforeIndex: 2 });
    cap.remove();
  });

  it("delete on row 2 dispatches recorder:request-delete {index:2}", () => {
    const cap = captureEvent("recorder:request-delete");
    fireEvent.click(screen.getByTestId("button-delete-action-2"));
    expect(cap.calls[0]!.detail).toMatchObject({ index: 2 });
    cap.remove();
  });

  it("bulk delete dispatches recorder:request-delete-bulk with the selected indices in display order", () => {
    fireEvent.click(screen.getByTestId("checkbox-action-0"));
    fireEvent.click(screen.getByTestId("checkbox-action-2"));
    const cap = captureEvent("recorder:request-delete-bulk");
    fireEvent.click(screen.getByTestId("button-delete-selected-actions"));
    expect(cap.calls[0]!.detail).toMatchObject({ indices: [0, 2] });
    cap.remove();
  });

  it("Select all + Delete dispatches recorder:request-delete-bulk with every visible index", () => {
    fireEvent.click(screen.getByTestId("checkbox-select-all-actions"));
    const cap = captureEvent("recorder:request-delete-bulk");
    fireEvent.click(screen.getByTestId("button-delete-selected-actions"));
    expect(cap.calls[0]!.detail).toMatchObject({ indices: [0, 1, 2] });
    cap.remove();
  });
});

describe("<ActionsFeed /> reacts to server-broadcast events", () => {
  it("recorder:action-deleted removes the matching row", () => {
    render(<ActionsFeed />);
    emitAction({
      type: "click",
      selector: '[data-testid="alpha"]',
      index: 0,
    });
    emitAction({
      type: "click",
      selector: '[data-testid="beta"]',
      index: 1,
    });
    expect(screen.getByTestId("action-feed-item-1")).toBeDefined();
    act(() => {
      window.dispatchEvent(
        new CustomEvent("recorder:action-deleted", {
          detail: { index: 1 },
        }),
      );
    });
    expect(screen.queryByTestId("action-feed-item-1")).toBeNull();
    expect(screen.getByTestId("action-feed-item-0")).toBeDefined();
  });

  it("recorder:feed-reset replaces the row list wholesale", () => {
    render(<ActionsFeed />);
    emitAction({
      type: "click",
      selector: '[data-testid="alpha"]',
      index: 0,
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent("recorder:feed-reset", {
          detail: {
            items: [
              {
                type: "click",
                selector: '[data-testid="reset"]',
                index: 0,
              },
            ],
          },
        }),
      );
    });
    expect(screen.getByTestId("action-feed-item-0")).toBeDefined();
  });
});

describe("<ActionsFeed /> undo-toast restore flow", () => {
  function emitFeed(items: Array<Record<string, unknown>>): void {
    act(() => {
      window.dispatchEvent(
        new CustomEvent("recorder:feed-reset", { detail: { items } }),
      );
    });
  }

  it("clicking Undo on the move-up toast dispatches the inverse move-down at the new array index", () => {
    render(<ActionsFeed />);
    emitFeed([
      { type: "click", selector: '[data-testid="alpha"]', index: 0 },
      { type: "click", selector: '[data-testid="beta"]', index: 1 },
    ]);
    const dispatched = captureEvent("recorder:request-move-action");
    fireEvent.click(screen.getByTestId("button-move-up-action-1"));
    expect(dispatched.calls.at(-1)?.detail).toEqual({
      index: 1,
      direction: "up",
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Step moved up",
      expect.objectContaining({ action: expect.any(Object) }),
    );

    // Invoke the toast's Undo callback and confirm the inverse event
    // fires for the new array index of the moved row (the row that
    // used to live at index 0 now lives at index 0 too — see
    // showMoveUndo: prevArrayIdx of the click that was at index 1).
    const action = lastToastAction();
    action.onClick();
    const undoEvt = dispatched.calls.at(-1)!.detail as Record<string, unknown>;
    expect(undoEvt).toEqual({ index: 0, direction: "down" });
    dispatched.remove();
  });

  it("clicking Undo on the duplicate toast dispatches recorder:request-delete at the inserted index (a.index + 1)", () => {
    render(<ActionsFeed />);
    emitFeed([
      { type: "click", selector: '[data-testid="alpha"]', index: 0 },
      { type: "click", selector: '[data-testid="beta"]', index: 1 },
    ]);
    const dupDispatched = captureEvent("recorder:request-duplicate-action");
    const delDispatched = captureEvent("recorder:request-delete");
    fireEvent.click(screen.getByTestId("button-duplicate-action-0"));
    expect(dupDispatched.calls.at(-1)?.detail).toEqual({ index: 0 });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Step duplicated",
      expect.objectContaining({ action: expect.any(Object) }),
    );
    const action = lastToastAction();
    action.onClick();
    expect(delDispatched.calls.at(-1)?.detail).toEqual({ index: 1 });
    dupDispatched.remove();
    delDispatched.remove();
  });

  it("clicking Undo on the move-down toast dispatches the inverse move-up at the new array index", () => {
    render(<ActionsFeed />);
    emitFeed([
      { type: "click", selector: '[data-testid="alpha"]', index: 0 },
      { type: "click", selector: '[data-testid="beta"]', index: 1 },
    ]);
    const dispatched = captureEvent("recorder:request-move-action");
    fireEvent.click(screen.getByTestId("button-move-down-action-0"));
    expect(dispatched.calls.at(-1)?.detail).toEqual({
      index: 0,
      direction: "down",
    });
    const action = lastToastAction();
    action.onClick();
    const undoEvt = dispatched.calls.at(-1)!.detail as Record<string, unknown>;
    expect(undoEvt).toEqual({ index: 1, direction: "up" });
    dispatched.remove();
  });
});


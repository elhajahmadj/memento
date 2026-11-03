import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

import { ActionsFeed, RecordingCanvas, TestBodyPreview } from "../workbench";

interface SentMessage {
  raw: string;
  parsed: { type?: string; indices?: number[]; index?: number };
}

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: SentMessage[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    let parsed: SentMessage["parsed"] = {};
    try {
      parsed = JSON.parse(data);
    } catch {
      /* ignore */
    }
    this.sent.push({ raw: data, parsed });
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  // Helpers used by tests.
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function pushAction(
  ws: FakeWebSocket,
  index: number,
  overrides: Record<string, unknown> = {},
) {
  act(() => {
    ws.emit({
      type: "action",
      index,
      // Omit suggestedMethodName so the name-prompt dialog never opens
      // during the test — we only care about the feed + WS contract here.
      action: {
        type: "click",
        selector: `#btn-${index}`,
        strategy: "id",
        ...overrides,
      },
    });
  });
}

function emitBodyPreview(
  ws: FakeWebSocket,
  actionIndices: number[],
) {
  // Two leading setup lines (no action) followed by one line per action.
  const lines = [
    "// setup line A",
    "// setup line B",
    ...actionIndices.map((i) => `await Selectors.Btn${i}.ClickAsync();`),
  ];
  const lineActionIndices: Array<number | null> = [
    null,
    null,
    ...actionIndices,
  ];
  act(() => {
    ws.emit({ type: "bodyPreview", lines, lineActionIndices });
  });
}

function emitActionDeleted(ws: FakeWebSocket, index: number) {
  act(() => {
    ws.emit({ type: "actionDeleted", index });
  });
}

function renderRecorderPanes() {
  // RecordingCanvas calls `useGetCurrentProject` (task #52) so the live
  // preview can route through the language-appropriate noun helper.
  // That hook needs a QueryClientProvider in scope — without one
  // react-query throws at module load. The provider is purely a stub
  // here: no network query is awaited because RecordingCanvas only
  // reads `data?.project?.language` synchronously.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <div>
        <ActionsFeed />
        <RecordingCanvas />
        <TestBodyPreview />
      </div>
    </QueryClientProvider>,
  );
}

function getActiveWebSocket(): FakeWebSocket {
  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!ws) throw new Error("RecordingCanvas did not open a WebSocket");
  return ws;
}

function bulkDeleteMessages(ws: FakeWebSocket) {
  return ws.sent.filter((m) => m.parsed.type === "delete-actions");
}

function singleDeleteMessages(ws: FakeWebSocket) {
  return ws.sent.filter((m) => m.parsed.type === "delete-action");
}

describe("bulk-delete and trim-from-here recorder flows", () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    originalWebSocket = globalThis.WebSocket;
    (globalThis as { WebSocket: unknown }).WebSocket =
      FakeWebSocket as unknown as typeof WebSocket;
    toastMock.mockClear();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
    toastMock.info.mockClear();
    toastMock.warning.mockClear();
    toastMock.dismiss.mockClear();
  });

  afterEach(() => {
    cleanup();
    (globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket;
    // Clear any cross-test residue from the global event bus.
    act(() => {
      window.dispatchEvent(
        new CustomEvent("recorder:action", { detail: "reset" }),
      );
      window.dispatchEvent(
        new CustomEvent("recorder:body-preview", {
          detail: { lines: [], lineActionIndices: [] },
        }),
      );
    });
  });

  function bootstrapFiveActions() {
    renderRecorderPanes();
    const ws = getActiveWebSocket();
    act(() => ws.open());
    // Some clicks and a fill — five recorded actions in total.
    pushAction(ws, 0, { type: "click", selector: "#login" });
    pushAction(ws, 1, { type: "click", selector: "#email" });
    pushAction(ws, 2, {
      type: "fill",
      selector: "#email",
      value: "user@example.com",
    });
    pushAction(ws, 3, { type: "click", selector: "#password" });
    pushAction(ws, 4, { type: "click", selector: "#submit" });
    emitBodyPreview(ws, [0, 1, 2, 3, 4]);
    return ws;
  }

  it("multi-selecting non-contiguous rows and clicking Delete (N) sends ONE delete-actions batch and clears those rows + preview lines", async () => {
    const ws = bootstrapFiveActions();

    // Sanity: all five rows + matching preview lines are present.
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`action-feed-item-${i}`)).toBeTruthy();
      expect(screen.getByTestId(`preview-line-action-${i}`)).toBeTruthy();
    }

    // Tick boxes for non-contiguous indices 1 and 3 via individual clicks
    // (no shift held).
    fireEvent.click(screen.getByTestId("checkbox-action-1"));
    fireEvent.click(screen.getByTestId("checkbox-action-3"));

    // The bulk-delete button surfaces the count.
    const bulkBtn = screen.getByTestId("button-delete-selected-actions");
    expect(bulkBtn.textContent ?? "").toContain("(2)");

    fireEvent.click(bulkBtn);

    // Exactly one batched WS message, with the two selected indices in
    // visible order — and zero individual `delete-action` sends.
    const batches = bulkDeleteMessages(ws);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.parsed.indices).toEqual([1, 3]);
    expect(singleDeleteMessages(ws)).toHaveLength(0);

    // Server confirms the deletes (per-index actionDeleted) and re-broadcasts
    // a body preview that omits the now-deleted actions.
    emitActionDeleted(ws, 1);
    emitActionDeleted(ws, 3);
    emitBodyPreview(ws, [0, 2, 4]);

    // The deleted rows disappear; the survivors remain.
    await waitFor(() => {
      expect(screen.queryByTestId("action-feed-item-1")).toBeNull();
      expect(screen.queryByTestId("action-feed-item-3")).toBeNull();
    });
    expect(screen.getByTestId("action-feed-item-0")).toBeTruthy();
    expect(screen.getByTestId("action-feed-item-2")).toBeTruthy();
    expect(screen.getByTestId("action-feed-item-4")).toBeTruthy();

    // The live preview no longer references the deleted action indices.
    expect(screen.queryByTestId("preview-line-action-1")).toBeNull();
    expect(screen.queryByTestId("preview-line-action-3")).toBeNull();
    expect(screen.getByTestId("preview-line-action-0")).toBeTruthy();
    expect(screen.getByTestId("preview-line-action-2")).toBeTruthy();
    expect(screen.getByTestId("preview-line-action-4")).toBeTruthy();

    // The bulk-action selection state resets after the batch fires, so the
    // toolbar count goes back to the unselected label.
    expect(
      screen.getByTestId("button-delete-selected-actions").textContent ?? "",
    ).not.toContain("(");
  });

  it("shift-clicking a checkbox selects a contiguous range and deletes it as one delete-actions batch", () => {
    const ws = bootstrapFiveActions();

    // Anchor at index 1, then shift-click index 3 to select 1..3 inclusive.
    fireEvent.click(screen.getByTestId("checkbox-action-1"));
    fireEvent.click(screen.getByTestId("checkbox-action-3"), { shiftKey: true });

    // The other rows must remain unchecked.
    const cb0 = screen.getByTestId("checkbox-action-0") as HTMLInputElement;
    const cb4 = screen.getByTestId("checkbox-action-4") as HTMLInputElement;
    expect(cb0.checked).toBe(false);
    expect(cb4.checked).toBe(false);

    const bulkBtn = screen.getByTestId("button-delete-selected-actions");
    expect(bulkBtn.textContent ?? "").toContain("(3)");
    fireEvent.click(bulkBtn);

    const batches = bulkDeleteMessages(ws);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.parsed.indices).toEqual([1, 2, 3]);
    expect(singleDeleteMessages(ws)).toHaveLength(0);
  });

  it("clicking 'delete this and all after' on a middle row sends ONE delete-actions batch covering the tail", async () => {
    const ws = bootstrapFiveActions();

    // The button only renders for rows that are not the last row, so it
    // must exist for index 2 and not for index 4.
    expect(screen.getByTestId("button-delete-from-here-2")).toBeTruthy();
    expect(screen.queryByTestId("button-delete-from-here-4")).toBeNull();

    fireEvent.click(screen.getByTestId("button-delete-from-here-2"));

    const batches = bulkDeleteMessages(ws);
    expect(batches).toHaveLength(1);
    // Tail = the clicked index plus everything after it, in display order.
    expect(batches[0]!.parsed.indices).toEqual([2, 3, 4]);
    expect(singleDeleteMessages(ws)).toHaveLength(0);

    // Server confirms the tail deletion and re-broadcasts the trimmed preview.
    emitActionDeleted(ws, 2);
    emitActionDeleted(ws, 3);
    emitActionDeleted(ws, 4);
    emitBodyPreview(ws, [0, 1]);

    // The trimmed rows disappear from the feed.
    await waitFor(() => {
      expect(screen.queryByTestId("action-feed-item-2")).toBeNull();
      expect(screen.queryByTestId("action-feed-item-3")).toBeNull();
      expect(screen.queryByTestId("action-feed-item-4")).toBeNull();
    });
    // The two head rows remain.
    expect(screen.getByTestId("action-feed-item-0")).toBeTruthy();
    expect(screen.getByTestId("action-feed-item-1")).toBeTruthy();

    // Preview no longer references the trimmed indices.
    expect(screen.queryByTestId("preview-line-action-2")).toBeNull();
    expect(screen.queryByTestId("preview-line-action-3")).toBeNull();
    expect(screen.queryByTestId("preview-line-action-4")).toBeNull();
  });
});

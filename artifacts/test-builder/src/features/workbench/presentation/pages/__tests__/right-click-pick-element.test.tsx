import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

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

// Main's parallel Task #36 introduced HistoryPanel into the workbench,
// which calls useIsAnyAdmin / useAuth. Stub both so this RTL spec
// doesn't have to wrap the page in a real AuthProvider.
vi.mock("@/features/auth/presentation/role", () => ({
  useIsAnyAdmin: () => true,
  useRole: () => "admin",
}));
vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => ({
    user: { id: "u1", role: "admin" },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { RecordingCanvas, RightPanel } from "../workbench";

interface SentMessage {
  raw: string;
  parsed: Record<string, unknown>;
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
    let parsed: Record<string, unknown> = {};
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

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function getActiveWebSocket(): FakeWebSocket {
  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!ws) throw new Error("RecordingCanvas did not open a WebSocket");
  return ws;
}

function emitFrame(ws: FakeWebSocket, width: number, height: number) {
  // Tiny base64 PNG payload — the data is not decoded in jsdom; the
  // canvas only needs `frame` to be set so the <img> trigger renders.
  act(() => {
    ws.emit({
      type: "frame",
      width,
      height,
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
    });
  });
}

function renderRecorderUI() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
    <div>
      <RightPanel
        tests={[]}
        onAddClass={vi.fn()}
        onAddMethod={vi.fn()}
        onValidateClass={vi.fn()}
        onValidateMethod={vi.fn()}
        onValidateSession={vi.fn()}
        recording
        stopped={false}
      />
      <RecordingCanvas />
    </div>
    </QueryClientProvider>,
  );
}

describe("right-click 'Assert text on this element' picks the element and seeds the assertion dialog", () => {
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

  it("right-click → pick → server pickElementResult → dialog opens prefilled → confirm → assertion appears in feed", async () => {
    renderRecorderUI();
    const ws = getActiveWebSocket();
    act(() => ws.open());

    // The canvas only renders the right-clickable image after the first
    // frame arrives; without it there's nothing to right-click on.
    emitFrame(ws, 800, 600);
    const canvas = (await screen.findByTestId(
      "recording-canvas",
    )) as HTMLImageElement;

    // Pin the rendered image to a known viewport rect so the canvas's
    // px → frame-coord translation produces predictable pick coordinates.
    // The component uses getBoundingClientRect, which jsdom returns as
    // zeros by default — stub it for this element.
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    } as DOMRect);

    // Right-click at (100, 75) in CSS pixels. With a 400×300 displayed
    // image of an 800×600 frame, that maps to frame coords (200, 150).
    act(() => {
      fireEvent.contextMenu(canvas, { clientX: 100, clientY: 75 });
    });

    // Radix portals the context-menu content into document.body. Wait
    // for the "Assert text on this element" item to render, then click
    // it to fire the canvas's `sendPickAtLastCoords` and emit the WS
    // pick-element message.
    const pickItem = await waitFor(() =>
      screen.getByTestId("menuitem-assert-text-here"),
    );
    act(() => {
      fireEvent.click(pickItem);
    });

    // Exactly one pick-element message went out, carrying the rounded
    // frame-space coordinates derived from the click.
    const pickMsgs = ws.sent.filter((m) => m.parsed.type === "pick-element");
    expect(pickMsgs).toHaveLength(1);
    expect(pickMsgs[0]!.parsed.x).toBe(200);
    expect(pickMsgs[0]!.parsed.y).toBe(150);

    // Dialog must not be open yet — it only opens once the server
    // resolves the selector + visible text and the canvas forwards the
    // result via the `recorder:assert-prefill` event bus.
    expect(screen.queryByTestId("dialog-add-assertion")).toBeNull();

    // Server resolves the element under that point and ships back the
    // selector + visible text. The canvas dispatches assert-prefill,
    // RightPanel re-opens AddAssertionDialog with both fields seeded.
    act(() => {
      ws.emit({
        type: "pickElementResult",
        selector: "#welcome-banner",
        strategy: "ById",
        text: "Welcome back, Ada",
      });
    });

    const dialog = await waitFor(() =>
      screen.getByTestId("dialog-add-assertion"),
    );
    expect(dialog).toBeTruthy();

    // The "element has text" radio is selected (so the selector + text
    // inputs are the visible form, not the URL one).
    const radio = screen.getByTestId(
      "radio-assert-element-has-text",
    ) as HTMLElement;
    expect(radio.getAttribute("data-state")).toBe("checked");

    const selectorInput = screen.getByTestId(
      "input-assert-selector",
    ) as HTMLInputElement;
    const textInput = screen.getByTestId(
      "input-assert-text",
    ) as HTMLInputElement;
    expect(selectorInput.value).toBe("#welcome-banner");
    expect(textInput.value).toBe("Welcome back, Ada");

    // Confirm the prefilled values. The dialog dispatches
    // recorder:request-add-assertion, which the canvas forwards to the
    // server via WS as `add-assertion`.
    const addBtn = screen.getByTestId("button-assertion-add");
    expect((addBtn as HTMLButtonElement).disabled).toBe(false);
    act(() => {
      fireEvent.click(addBtn);
    });

    // Exactly one add-assertion message went out, faithfully carrying
    // the kind, selector, and visible text the user just confirmed.
    const addMsgs = ws.sent.filter((m) => m.parsed.type === "add-assertion");
    expect(addMsgs).toHaveLength(1);
    expect(addMsgs[0]!.parsed.assertKind).toBe("element-has-text");
    expect(addMsgs[0]!.parsed.selector).toBe("#welcome-banner");
    expect(addMsgs[0]!.parsed.assertText).toBe("Welcome back, Ada");

    // Dialog closes after submit so it doesn't trap the user.
    await waitFor(() => {
      expect(screen.queryByTestId("dialog-add-assertion")).toBeNull();
    });

    // Server appends the assertion and broadcasts the new action; the
    // ActionsFeed should now show one assertion row carrying the same
    // selector and text the user confirmed.
    act(() => {
      ws.emit({
        type: "action",
        index: 0,
        suggestedMethodName: "AssertText1",
        action: {
          type: "assert",
          assertKind: "element-has-text",
          selector: "#welcome-banner",
          assertText: "Welcome back, Ada",
        },
      });
    });

    const feedRow = await waitFor(() =>
      screen.getByTestId("action-feed-item-0"),
    );
    expect(feedRow.textContent).toContain("#welcome-banner");
    expect(feedRow.textContent).toContain("Welcome back, Ada");
  });

  it("server pickElementError after a right-click pick surfaces a toast and never opens the assertion dialog", async () => {
    renderRecorderUI();
    const ws = getActiveWebSocket();
    act(() => ws.open());

    emitFrame(ws, 800, 600);
    const canvas = (await screen.findByTestId(
      "recording-canvas",
    )) as HTMLImageElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      fireEvent.contextMenu(canvas, { clientX: 40, clientY: 30 });
    });
    const pickItem = await waitFor(() =>
      screen.getByTestId("menuitem-assert-text-here"),
    );
    act(() => {
      fireEvent.click(pickItem);
    });

    // The pick request made it to the server.
    expect(
      ws.sent.filter((m) => m.parsed.type === "pick-element"),
    ).toHaveLength(1);

    // Server says nothing was under the cursor. The canvas surfaces
    // the error as a toast and the dialog must stay closed (otherwise
    // the user would land in a half-filled assertion form).
    act(() => {
      ws.emit({
        type: "pickElementError",
        message: "No element found at that point.",
      });
    });

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    const errCall = toastMock.error.mock.calls.at(-1);
    expect(String(errCall?.[0] ?? "")).toContain("No element found");
    expect(screen.queryByTestId("dialog-add-assertion")).toBeNull();
  });
});

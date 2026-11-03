/**
 * RTL specs for the combined fill + name recorder dialog. The server
 * side (one synthetic fill action carrying the user-supplied method
 * name) is already covered by Vitest in the api-server package; these
 * specs exercise the client behavior of `<RecordingCanvas />`:
 *
 *   - an editable-click action opens ONE combined dialog
 *     (`dialog-fill-prompt`) with both a value input and a name input
 *   - the name input is seeded with a language-aware default derived
 *     from the editable element's label
 *   - submitting both fields sends a single `fill` WS message that
 *     carries `methodName`
 *   - when the server then broadcasts the synthetic fill action with
 *     `methodName` set, the standalone "Name this action" dialog
 *     (`dialog-name-action`) is suppressed
 *   - clearing the name field before submit sends `fill` without
 *     `methodName`; if the server's follow-up fill action then omits
 *     `methodName` (auto-name path), the standalone name prompt falls
 *     back as expected
 *   - Cancel discards both inputs without sending anything
 */
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

import { RecordingCanvas } from "../workbench";

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

function renderRecorder() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RecordingCanvas />
    </QueryClientProvider>,
  );
}

/**
 * Emit the editable-click that the server sends after recording a
 * focus on a text input. This is the trigger that opens the combined
 * fill + name dialog. `index` and `suggestedMethodName` are present
 * because the server always assigns both — the canvas relies on
 * `editable` (not on the absence of a suggestion) to decide that the
 * combined dialog, not the standalone name prompt, should open.
 */
function emitEditableClick(
  ws: FakeWebSocket,
  opts: { index: number; label: string; selector: string },
) {
  act(() => {
    ws.emit({
      type: "action",
      index: opts.index,
      suggestedMethodName: "ClickInputAsync",
      action: {
        type: "click",
        selector: opts.selector,
        strategy: "id",
        editable: { label: opts.label, kind: "input" },
      },
    });
  });
}

/**
 * Emit the synthetic fill action that the server broadcasts after the
 * client submits a `fill`. When `methodName` is included the canvas
 * must NOT open the standalone "Name this action" dialog — the user
 * already supplied a name in the combined dialog.
 */
function emitFillAction(
  ws: FakeWebSocket,
  opts: { index: number; methodName?: string },
) {
  act(() => {
    ws.emit({
      type: "action",
      index: opts.index,
      suggestedMethodName: "FillUsernameAsync",
      ...(opts.methodName !== undefined ? { methodName: opts.methodName } : {}),
      action: { type: "fill", selector: "#username", strategy: "id" },
    });
  });
}

function fillMessages(ws: FakeWebSocket) {
  return ws.sent.filter((m) => m.parsed.type === "fill");
}

describe("combined fill + name recorder dialog", () => {
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
    });
  });

  it("opens one combined dialog with the name field seeded from the editable label, sends fill+methodName on submit, and suppresses the standalone name prompt when the synthetic fill carries methodName", async () => {
    renderRecorder();
    const ws = getActiveWebSocket();
    act(() => ws.open());

    emitEditableClick(ws, {
      index: 0,
      label: "Username",
      selector: "#username",
    });

    // Combined dialog renders with both inputs visible.
    const dialog = await waitFor(() =>
      screen.getByTestId("dialog-fill-prompt"),
    );
    expect(dialog).toBeTruthy();
    const valueInput = screen.getByTestId(
      "input-fill-value",
    ) as HTMLInputElement;
    const nameInput = screen.getByTestId(
      "input-fill-method-name",
    ) as HTMLInputElement;
    expect(valueInput).toBeTruthy();
    expect(nameInput).toBeTruthy();

    // No standalone "Name this action" dialog opens alongside the
    // combined one — the editable-click flow is single-prompt.
    expect(screen.queryByTestId("dialog-name-action")).toBeNull();

    // Name input is pre-seeded with a language-aware default derived
    // from the label. With no current project resolved the canvas
    // falls back to C# (PascalCase noun): "Username" → "Username".
    expect(nameInput.value).toBe("Username");

    // Type a value, replace the seeded name, then submit. The dialog
    // must send ONE `fill` message carrying both the value and the
    // user-supplied method name.
    fireEvent.change(valueInput, { target: { value: "ada@example.com" } });
    fireEvent.change(nameInput, { target: { value: "LoginEmail" } });
    fireEvent.click(screen.getByTestId("button-fill-submit"));

    const fills = fillMessages(ws);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.parsed).toMatchObject({
      type: "fill",
      value: "ada@example.com",
      selector: "#username",
      methodName: "LoginEmail",
    });

    // Submitting closes the combined dialog.
    await waitFor(() => {
      expect(screen.queryByTestId("dialog-fill-prompt")).toBeNull();
    });

    // The server applies the user-supplied name to the synthetic fill
    // and re-broadcasts the action with `methodName` set. The canvas
    // must NOT enqueue a standalone "Name this action" prompt for it.
    emitFillAction(ws, { index: 1, methodName: "LoginEmail" });
    expect(screen.queryByTestId("dialog-name-action")).toBeNull();
  });

  it("clearing the name field sends fill without methodName and the standalone name prompt falls back when the server's synthetic fill omits methodName", async () => {
    renderRecorder();
    const ws = getActiveWebSocket();
    act(() => ws.open());

    emitEditableClick(ws, {
      index: 0,
      label: "Username",
      selector: "#username",
    });

    const valueInput = (await waitFor(() =>
      screen.getByTestId("input-fill-value"),
    )) as HTMLInputElement;
    const nameInput = screen.getByTestId(
      "input-fill-method-name",
    ) as HTMLInputElement;

    // User clears the seeded name and types only the value.
    fireEvent.change(nameInput, { target: { value: "" } });
    fireEvent.change(valueInput, { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByTestId("button-fill-submit"));

    const fills = fillMessages(ws);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.parsed).toMatchObject({
      type: "fill",
      value: "ada@example.com",
      selector: "#username",
    });
    // Empty name → no `methodName` key in the payload (server falls
    // back to its auto-generated name).
    expect("methodName" in fills[0]!.parsed).toBe(false);

    // Server broadcasts the synthetic fill action WITHOUT a methodName
    // because the client didn't supply one. The canvas should fall
    // back to enqueueing the standalone "Name this action" prompt.
    emitFillAction(ws, { index: 1 });

    const namePromptDialog = await waitFor(() =>
      screen.getByTestId("dialog-name-action"),
    );
    expect(namePromptDialog).toBeTruthy();
    // The standalone prompt's input is pre-filled with the server's
    // suggestion (not the cleared value from the combined dialog).
    const nameActionInput = screen.getByTestId(
      "input-action-method-name",
    ) as HTMLInputElement;
    expect(nameActionInput.value).toBe("FillUsernameAsync");
  });

  it("Cancel closes the combined dialog without sending fill, and the standalone name prompt does not appear", async () => {
    renderRecorder();
    const ws = getActiveWebSocket();
    act(() => ws.open());

    emitEditableClick(ws, {
      index: 0,
      label: "Username",
      selector: "#username",
    });

    await waitFor(() => screen.getByTestId("dialog-fill-prompt"));
    fireEvent.change(screen.getByTestId("input-fill-value"), {
      target: { value: "discarded" },
    });
    fireEvent.change(screen.getByTestId("input-fill-method-name"), {
      target: { value: "DiscardedName" },
    });
    fireEvent.click(screen.getByTestId("button-fill-cancel"));

    // Combined dialog closes and nothing was sent over the WebSocket.
    await waitFor(() => {
      expect(screen.queryByTestId("dialog-fill-prompt")).toBeNull();
    });
    expect(fillMessages(ws)).toHaveLength(0);
    // No follow-up standalone prompt — the editable click was discarded.
    expect(screen.queryByTestId("dialog-name-action")).toBeNull();
  });
});

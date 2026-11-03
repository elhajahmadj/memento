/**
 * RTL specs for <InsertSharedStepDialog /> — Tier 2 shared steps picker.
 * The dialog:
 *  1. fetches /api/shared-steps on open and renders an option per macro
 *  2. defaults to "After focused step" when the actions feed has a row
 *     focused (`position.focusedIndex != null`); otherwise "End of"
 *  3. dispatches `recorder:request-insert-shared-step` with
 *       { name }                                 (end / append)
 *       { name, atIndex: focusedIndex + 1 }       (after focused row)
 *  4. shows the empty-state copy when the library is empty
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

import { InsertSharedStepDialog } from "../insert-shared-step-dialog";

function captureEvent(name: string) {
  const calls: CustomEvent[] = [];
  const handler = (e: Event) => calls.push(e as CustomEvent);
  window.addEventListener(name, handler as EventListener);
  return {
    calls,
    remove: () => window.removeEventListener(name, handler as EventListener),
  };
}

const fetchMock = vi.fn();
let onOpenChange: ((v: boolean) => void) & ReturnType<typeof vi.fn>;

beforeEach(() => {
  onOpenChange = vi.fn() as unknown as typeof onOpenChange;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockListResponse(items: Array<{ name: string; actions: unknown[] }>) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    text: async () => "",
    json: async () => ({
      items: items.map((s, i) => ({
        id: `id-${i}`,
        name: s.name,
        description: "",
        actions: s.actions,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    }),
  });
}

describe("<InsertSharedStepDialog />", () => {
  it("fetches /api/shared-steps on open and renders the preview for the first item", async () => {
    mockListResponse([
      {
        name: "LoginAsAdmin",
        actions: [{ type: "click", selector: "[data-testid=login]" }],
      },
    ]);
    render(
      <InsertSharedStepDialog open={true} onOpenChange={onOpenChange} />,
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/shared-steps",
        expect.any(Object),
      );
      expect(screen.getByTestId("button-insert-shared-step-confirm")).toBeTruthy();
    });
  });

  it("APPEND path: dispatches { name } only when no row is focused", async () => {
    mockListResponse([
      {
        name: "FillForm",
        actions: [{ type: "fill", selector: "#x", value: "v" }],
      },
    ]);
    render(
      <InsertSharedStepDialog
        open={true}
        onOpenChange={onOpenChange}
        position={{ liveCount: 5, focusedIndex: null }}
      />,
    );
    await waitFor(() =>
      expect(
        (screen.getByTestId("button-insert-shared-step-confirm") as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    const cap = captureEvent("recorder:request-insert-shared-step");
    fireEvent.click(screen.getByTestId("button-insert-shared-step-confirm"));
    expect(cap.calls[0]!.detail).toEqual({ name: "FillForm" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    cap.remove();
  });

  it("INSERT-AFTER path: dispatches { name, atIndex: focusedIndex + 1 } when a row is focused", async () => {
    mockListResponse([
      {
        name: "ClickLogin",
        actions: [{ type: "click", selector: "[data-testid=login]" }],
      },
    ]);
    render(
      <InsertSharedStepDialog
        open={true}
        onOpenChange={onOpenChange}
        position={{
          liveCount: 4,
          focusedIndex: 2,
          focusedLabel: "3. ClickLogin",
        }}
      />,
    );
    await waitFor(() =>
      expect(
        (screen.getByTestId("button-insert-shared-step-confirm") as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    const cap = captureEvent("recorder:request-insert-shared-step");
    fireEvent.click(screen.getByTestId("button-insert-shared-step-confirm"));
    expect(cap.calls[0]!.detail).toEqual({
      name: "ClickLogin",
      atIndex: 3, // focusedIndex (2) + 1
    });
    cap.remove();
  });

  it("renders an empty-state copy and disables the confirm button when no macros exist", async () => {
    mockListResponse([]);
    render(
      <InsertSharedStepDialog open={true} onOpenChange={onOpenChange} />,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/No shared steps saved yet/i),
      ).toBeTruthy();
    });
    // The confirm button stays rendered but disabled when there's no
    // chosen macro to insert.
    expect(
      (screen.getByTestId("button-insert-shared-step-confirm") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

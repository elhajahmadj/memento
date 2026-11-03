/**
 * RTL specs for <CaptureLoginDialog /> + the Start-Recording dialog's
 * "Use saved login" checkbox. Verifies:
 *
 *   - On open, the dialog GETs /api/auth-state and surfaces an existing
 *     row (label + delete button) when one is present.
 *   - "Start capture" POSTs /api/recording/start with captureMode: true
 *     and transitions to the live-canvas phase.
 *   - "Save login" POSTs /api/auth-state/save with the typed label, then
 *     finalizes the underlying capture session and toasts success.
 *   - Failure surfaces a toast.error and leaves the dialog open.
 *   - The Start-Recording "Use saved login" checkbox round-trips into
 *     the recording start config as `useSavedLogin: true`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

import { CaptureLoginDialog } from "../capture-login-dialog";

const fetchMock = vi.fn();
let onOpenChange: ((v: boolean) => void) & ReturnType<typeof vi.fn>;
let onChanged: () => void;

beforeEach(() => {
  onOpenChange = vi.fn() as unknown as typeof onOpenChange;
  onChanged = vi.fn();
  fetchMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<CaptureLoginDialog /> setup → capturing → save flow", () => {
  it("renders the existing-saved-login banner with a Delete affordance when a row already exists", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hasState: true,
        label: "QA admin",
        updatedAt: new Date("2026-04-01").toISOString(),
      }),
    });
    render(
      <CaptureLoginDialog
        open={true}
        onOpenChange={onOpenChange}
        onChanged={onChanged}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("button-delete-saved-login")).toBeTruthy();
      expect(screen.getByText(/QA admin/)).toBeTruthy();
    });
  });

  it("Start capture POSTs captureMode:true to /api/recording/start and transitions to the capturing phase", async () => {
    // 1st call: GET /api/auth-state on open
    // 2nd call: POST /api/recording/start
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hasState: false, label: null, updatedAt: null }),
      })
      .mockResolvedValueOnce({ ok: true, text: async () => "" });
    render(
      <CaptureLoginDialog
        open={true}
        onOpenChange={onOpenChange}
        onChanged={onChanged}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("input-capture-url")).toBeTruthy(),
    );
    fireEvent.change(screen.getByTestId("input-capture-url"), {
      target: { value: "https://app.example.com/login" },
    });
    fireEvent.click(screen.getByTestId("button-start-capture"));

    await waitFor(() =>
      expect(screen.getByTestId("button-save-login")).toBeTruthy(),
    );
    const startCall = fetchMock.mock.calls[1]!;
    expect(startCall[0]).toBe("/api/recording/start");
    const body = JSON.parse(startCall[1].body);
    expect(body).toMatchObject({
      startUrl: "https://app.example.com/login",
      captureMode: true,
    });
  });

  it("Save login POSTs the label to /api/auth-state/save then finalizes and closes", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hasState: false, label: null, updatedAt: null }),
      })
      .mockResolvedValueOnce({ ok: true, text: async () => "" }) // start
      .mockResolvedValueOnce({ ok: true, text: async () => "" }) // /save
      .mockResolvedValueOnce({ ok: true, text: async () => "" }); // /finalize
    render(
      <CaptureLoginDialog
        open={true}
        onOpenChange={onOpenChange}
        onChanged={onChanged}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("button-start-capture")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("button-start-capture"));
    await waitFor(() =>
      expect(screen.getByTestId("input-capture-label-2")).toBeTruthy(),
    );
    fireEvent.change(screen.getByTestId("input-capture-label-2"), {
      target: { value: "QA admin" },
    });
    fireEvent.click(screen.getByTestId("button-save-login"));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringMatching(/Saved login/i),
      );
      expect(onChanged).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    const saveCall = fetchMock.mock.calls[2]!;
    expect(saveCall[0]).toBe("/api/auth-state/save");
    expect(JSON.parse(saveCall[1].body)).toEqual({ label: "QA admin" });
    const finalizeCall = fetchMock.mock.calls[3]!;
    expect(finalizeCall[0]).toBe("/api/recording/finalize");
  });

  it("toasts an error and stays in setup phase when /api/recording/start fails", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hasState: false, label: null, updatedAt: null }),
      })
      .mockResolvedValueOnce({ ok: false, text: async () => "boom" });
    render(
      <CaptureLoginDialog
        open={true}
        onOpenChange={onOpenChange}
        onChanged={onChanged}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("button-start-capture")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("button-start-capture"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining("boom")),
    );
    // Still in setup — Start button is still rendered.
    expect(screen.getByTestId("button-start-capture")).toBeTruthy();
    expect(screen.queryByTestId("button-save-login")).toBeNull();
  });
});

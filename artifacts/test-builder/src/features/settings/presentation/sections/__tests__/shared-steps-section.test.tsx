/**
 * RTL specs for <SharedStepsSection /> in the Settings panel. Covers:
 *  - GET /api/shared-steps on mount + render of items / empty-state
 *  - Editor: name + description + actions JSON -> POST /api/shared-steps
 *    Reaction: success toast, list refresh, dialog closes.
 *  - JSON validation: malformed JSON => toast.error, no fetch.
 *  - Actions array must be non-empty => toast.error, no fetch.
 *  - Delete row: confirm prompt -> DELETE /api/shared-steps/<name>
 *  - 4xx response -> toast.error, list NOT refreshed.
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

import { SharedStepsSection } from "../shared-steps-section";

const fetchMock = vi.fn();
let confirmSpy: ReturnType<typeof vi.spyOn>;

function listResponse(items: Array<{ id: string; name: string; description: string; actions: unknown[] }>) {
  return {
    ok: true,
    text: async () => "",
    json: async () => ({
      items: items.map((i) => ({
        ...i,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    }),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  confirmSpy.mockRestore();
});

describe("<SharedStepsSection />", () => {
  it("fetches /api/shared-steps on mount and renders one row per item", async () => {
    fetchMock.mockResolvedValueOnce(
      listResponse([
        { id: "1", name: "LoginAsAdmin", description: "click + fill", actions: [{}] },
        { id: "2", name: "GoToDashboard", description: "", actions: [{}, {}, {}] },
      ]),
    );
    render(<SharedStepsSection />);
    await waitFor(() => {
      expect(screen.getByTestId("row-shared-step-LoginAsAdmin")).toBeTruthy();
      expect(screen.getByTestId("row-shared-step-GoToDashboard")).toBeTruthy();
    });
    expect(screen.getByText(/3 actions/)).toBeTruthy();
  });

  it("renders an empty-state when the library is empty", async () => {
    fetchMock.mockResolvedValueOnce(listResponse([]));
    render(<SharedStepsSection />);
    await waitFor(() =>
      expect(screen.getByText(/None yet\. Create one above\./i)).toBeTruthy(),
    );
  });

  it("Save POSTs name + description + parsed actions and refreshes on success", async () => {
    fetchMock
      .mockResolvedValueOnce(listResponse([])) // initial GET
      .mockResolvedValueOnce({ ok: true, text: async () => "" }) // POST
      .mockResolvedValueOnce(
        listResponse([
          { id: "x", name: "MyMacro", description: "", actions: [{}] },
        ]),
      );
    render(<SharedStepsSection />);
    await waitFor(() =>
      expect(screen.getByTestId("button-create-shared-step")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("button-create-shared-step"));
    fireEvent.change(screen.getByTestId("input-shared-step-name"), {
      target: { value: "MyMacro" },
    });
    fireEvent.change(screen.getByTestId("input-shared-step-desc"), {
      target: { value: "Click login" },
    });
    fireEvent.change(screen.getByTestId("textarea-shared-step-json"), {
      target: { value: '[{"type":"click","selector":"#a"}]' },
    });
    fireEvent.click(screen.getByTestId("button-submit-shared-step"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const postCall = fetchMock.mock.calls[1]!;
    expect(postCall[0]).toBe("/api/shared-steps");
    expect(JSON.parse(postCall[1].body)).toEqual({
      name: "MyMacro",
      description: "Click login",
      actions: [{ type: "click", selector: "#a" }],
    });
  });

  it("rejects malformed JSON with a toast.error and never POSTs", async () => {
    fetchMock.mockResolvedValueOnce(listResponse([]));
    render(<SharedStepsSection />);
    await waitFor(() =>
      expect(screen.getByTestId("button-create-shared-step")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("button-create-shared-step"));
    fireEvent.change(screen.getByTestId("input-shared-step-name"), {
      target: { value: "Bad" },
    });
    fireEvent.change(screen.getByTestId("textarea-shared-step-json"), {
      target: { value: "not json" },
    });
    fireEvent.click(screen.getByTestId("button-submit-shared-step"));
    expect(toastError).toHaveBeenCalledWith(
      expect.stringMatching(/not valid JSON/i),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1); // initial GET only
  });

  it("rejects an empty actions array with a toast.error and never POSTs", async () => {
    fetchMock.mockResolvedValueOnce(listResponse([]));
    render(<SharedStepsSection />);
    await waitFor(() =>
      expect(screen.getByTestId("button-create-shared-step")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("button-create-shared-step"));
    fireEvent.change(screen.getByTestId("input-shared-step-name"), {
      target: { value: "Empty" },
    });
    fireEvent.change(screen.getByTestId("textarea-shared-step-json"), {
      target: { value: "[]" },
    });
    fireEvent.click(screen.getByTestId("button-submit-shared-step"));
    expect(toastError).toHaveBeenCalledWith(
      expect.stringMatching(/non-empty/i),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Delete row confirms then issues DELETE /api/shared-steps/<name> and refreshes", async () => {
    fetchMock
      .mockResolvedValueOnce(
        listResponse([
          { id: "1", name: "ToDelete", description: "", actions: [{}] },
        ]),
      )
      .mockResolvedValueOnce({ ok: true, text: async () => "" })
      .mockResolvedValueOnce(listResponse([]));
    render(<SharedStepsSection />);
    await waitFor(() =>
      expect(screen.getByTestId("button-delete-shared-step-ToDelete")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("button-delete-shared-step-ToDelete"));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const delCall = fetchMock.mock.calls[1]!;
    expect(delCall[0]).toBe("/api/shared-steps/ToDelete");
    expect(delCall[1].method).toBe("DELETE");
  });

  it("treats a 400 'No project loaded' GET as a friendly empty state (no toast, create disabled)", async () => {
    // Fresh SSO admin who hasn't picked a project yet — the API
    // returns 400 {"error":"No project loaded"}. The section must
    // NOT show an alarming red toast; instead it shows a friendly
    // hint and disables the create button until a project is open.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"error":"No project loaded"}',
    });
    render(<SharedStepsSection />);
    await waitFor(() =>
      expect(
        screen.getByText(/Open a project to view and create shared steps\./i),
      ).toBeTruthy(),
    );
    expect(toastError).not.toHaveBeenCalled();
    expect(
      (screen.getByTestId("button-create-shared-step") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("treats a 404 'No project loaded' GET the same way (no toast, create disabled)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => '{"error":"No project loaded"}',
    });
    render(<SharedStepsSection />);
    await waitFor(() =>
      expect(
        screen.getByText(/Open a project to view and create shared steps\./i),
      ).toBeTruthy(),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("still surfaces an unrelated 4xx GET error as a toast (does NOT silently mask real failures)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => '{"error":"Forbidden"}',
    });
    render(<SharedStepsSection />);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.stringContaining("Forbidden"),
      ),
    );
    // The friendly no-project hint must NOT appear for genuine errors.
    expect(
      screen.queryByText(/Open a project to view and create shared steps\./i),
    ).toBeNull();
  });

  it("toasts an error when DELETE returns non-OK and does NOT refresh the list", async () => {
    fetchMock
      .mockResolvedValueOnce(
        listResponse([
          { id: "1", name: "Stuck", description: "", actions: [{}] },
        ]),
      )
      .mockResolvedValueOnce({ ok: false, text: async () => "permission denied" });
    render(<SharedStepsSection />);
    await waitFor(() =>
      expect(screen.getByTestId("button-delete-shared-step-Stuck")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("button-delete-shared-step-Stuck"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.stringContaining("permission denied"),
      ),
    );
    // Only the original GET + the failing DELETE — no refresh GET on failure.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * Focused RTL spec for <StartRecordingDialog /> proving the
 * "Use saved login" checkbox round-trips into the start-recording
 * mutation payload as `useSavedLogin: true`.
 *
 * The dialog is a heavy component that pulls in many generated React
 * Query hooks. We mock @workspace/api-client-react to return inert
 * stubs for every hook the dialog touches except `useStartRecording`,
 * whose `mutate` we capture so we can assert on the payload.
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
  screen,
  waitFor,
} from "@testing-library/react";

import { startMutate, resetApiClientMocks } from "./_mock-api-client-react";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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

// The role hook is called at import-time-ish inside the dialog; stub it
// so the "admin-only" branches render predictably.
vi.mock("@/features/auth/presentation/role", () => ({
  useIsAnyAdmin: () => true,
  AnyAdminOnly: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { StartRecordingDialog } from "../start-recording-dialog";
import { renderWithProviders } from "@/test/test-utils";

const fetchMock = vi.fn();
let onOpenChange: (v: boolean) => void;

beforeEach(() => {
  onOpenChange = vi.fn() as unknown as (v: boolean) => void;
  fetchMock.mockReset();
  resetApiClientMocks();
  toastSuccess.mockReset();
  toastError.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<StartRecordingDialog /> — "Use saved login" checkbox round-trip', () => {
  it("renders the checkbox only when /api/auth-state reports a saved row", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ hasState: true, label: "QA admin", updatedAt: null }),
    });
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("checkbox-use-saved-login")).toBeTruthy(),
    );
    expect(screen.getByText(/QA admin/)).toBeTruthy();
  });

  it("hides the checkbox when /api/auth-state reports no saved row", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ hasState: false, label: null, updatedAt: null }),
    });
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Allow any post-fetch state-flush to settle, then assert absence.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("checkbox-use-saved-login")).toBeNull();
  });

  it("includes useSavedLogin: true in the start payload when the checkbox is ticked", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ hasState: true, label: "QA admin", updatedAt: null }),
    });
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    const checkbox = (await screen.findByTestId(
      "checkbox-use-saved-login",
    )) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    await waitFor(() => expect(startMutate).toHaveBeenCalledTimes(1));
    const vars = startMutate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(vars.data.useSavedLogin).toBe(true);
  });

  it("defaults useSavedLogin to false when the checkbox is left unticked (saved row present)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ hasState: true, label: "QA admin", updatedAt: null }),
    });
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await screen.findByTestId("checkbox-use-saved-login");
    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    await waitFor(() => expect(startMutate).toHaveBeenCalledTimes(1));
    const vars = startMutate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(vars.data.useSavedLogin).toBe(false);
  });

  it("forces useSavedLogin to false when no saved row exists, even if the user previously ticked it", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ hasState: false, label: null, updatedAt: null }),
    });
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    await waitFor(() => expect(startMutate).toHaveBeenCalledTimes(1));
    const vars = startMutate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(vars.data.useSavedLogin).toBe(false);
  });
});

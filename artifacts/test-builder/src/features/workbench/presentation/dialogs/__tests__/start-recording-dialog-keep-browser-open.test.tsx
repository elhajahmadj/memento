/**
 * Focused RTL spec for the task #121 "Keep browser open after stop
 * recording" checkbox on <StartRecordingDialog />.
 *
 * Asserts:
 *   1. The checkbox renders inside `section-keep-browser-open` and
 *      that section appears AFTER `section-ignore-test` in DOM order.
 *   2. The checkbox defaults to unchecked.
 *   3. When ticked, the value flows into the `/recording/start`
 *      mutation payload as `keepBrowserOpen: true`.
 *   4. When ticked in attach-mode, the value flows into the
 *      `/recording/attach-to-open-browser` mutation payload as
 *      `keepBrowserOpen: true`.
 *   5. When left unticked, both payloads pin `keepBrowserOpen: false`.
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

import {
  startMutate,
  attachMutate,
  resetApiClientMocks,
} from "./_mock-api-client-react";

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
  window.localStorage.clear();
  if (
    !(HTMLElement.prototype as unknown as { scrollIntoView?: unknown })
      .scrollIntoView
  ) {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  }
  // No saved-login row → the "Use saved login" checkbox stays out of
  // the way so it doesn't interact with the keep-browser-open one.
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ hasState: false, label: null, updatedAt: null }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<StartRecordingDialog /> — Keep browser open after stop (task #121)", () => {
  it("renders the checkbox inside section-keep-browser-open and AFTER section-ignore-test", async () => {
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const ignore = screen.getByTestId("section-ignore-test");
    const keep = screen.getByTestId("section-keep-browser-open");
    expect(keep).toBeTruthy();
    // The checkbox lives inside the keep-browser-open section.
    const checkbox = screen.getByTestId(
      "checkbox-keep-browser-open",
    ) as HTMLInputElement;
    expect(keep.contains(checkbox)).toBe(true);
    // The keep-browser-open section is below the ignore-test section.
    expect(
      ignore.compareDocumentPosition(keep) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("defaults the keep-browser-open checkbox to unchecked", async () => {
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const checkbox = screen.getByTestId(
      "checkbox-keep-browser-open",
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("threads keepBrowserOpen=true into the /recording/start payload when ticked", async () => {
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("checkbox-keep-browser-open"));
    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    await waitFor(() => expect(startMutate).toHaveBeenCalledTimes(1));
    const vars = startMutate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(vars.data.keepBrowserOpen).toBe(true);
    expect(attachMutate).not.toHaveBeenCalled();
  });

  it("threads keepBrowserOpen=false into the /recording/start payload by default", async () => {
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    await waitFor(() => expect(startMutate).toHaveBeenCalledTimes(1));
    const vars = startMutate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(vars.data.keepBrowserOpen).toBe(false);
  });

  it("threads keepBrowserOpen=true into the /recording/attach-to-open-browser payload when ticked in attach mode", async () => {
    renderWithProviders(
      <StartRecordingDialog
        open={true}
        onOpenChange={onOpenChange}
        attachToOpenBrowser={true}
        tests={[
          { path: "Tests/AttachSuite.cs", className: "AttachSuite" },
        ]}
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Attach mode forces existing-suite + testMethod target — the
    // dialog clamps both via a layout effect, so we just need to
    // pick the existing suite and a method name.
    fireEvent.click(screen.getByTestId("select-existing-class"));
    const option = await screen.findByRole("option", { name: /AttachSuite/ });
    fireEvent.click(option);
    fireEvent.change(screen.getByTestId("input-method-name"), {
      target: { value: "AttachedKeepOpen" },
    });
    fireEvent.click(screen.getByTestId("checkbox-keep-browser-open"));
    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    await waitFor(() => expect(attachMutate).toHaveBeenCalledTimes(1));
    const vars = attachMutate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(vars.data.keepBrowserOpen).toBe(true);
    expect(startMutate).not.toHaveBeenCalled();
  });

  it("threads keepBrowserOpen=false into the /recording/attach-to-open-browser payload by default", async () => {
    renderWithProviders(
      <StartRecordingDialog
        open={true}
        onOpenChange={onOpenChange}
        attachToOpenBrowser={true}
        tests={[
          { path: "Tests/AttachSuite.cs", className: "AttachSuite" },
        ]}
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("select-existing-class"));
    const option = await screen.findByRole("option", { name: /AttachSuite/ });
    fireEvent.click(option);
    fireEvent.change(screen.getByTestId("input-method-name"), {
      target: { value: "AttachedDefault" },
    });
    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    await waitFor(() => expect(attachMutate).toHaveBeenCalledTimes(1));
    const vars = attachMutate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(vars.data.keepBrowserOpen).toBe(false);
  });
});

/**
 * Focused RTL spec for <StartRecordingDialog /> proving the new
 * "Test Category" inputs and "Ignore this test" checkbox round-trip
 * into the start-recording mutation payload as `categoryConstantName`,
 * `categoryValue`, and `ignoreReason` — and that the both-or-neither
 * validation on the category pair (and required-reason validation on
 * the ignore checkbox) blocks submit before reaching the mutation.
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
  // The dialog now persists recently used categories / ignore reasons
  // to localStorage and offers them as <datalist> suggestions, with an
  // autofill of the value field when the constant name matches a
  // remembered entry. Clear between tests so a previous test's submit
  // can't autofill the next test's inputs.
  window.localStorage.clear();
  // jsdom doesn't implement scrollIntoView; Radix Select uses it.
  if (!(HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  }
  // No saved-login row so that branch stays out of the way.
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

describe("<StartRecordingDialog /> — Test Category & Ignore fields", () => {
  it("defaults all three fields to null in the start payload when the user fills nothing", async () => {
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    await waitFor(() => expect(startMutate).toHaveBeenCalledTimes(1));
    const vars = startMutate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(vars.data.ignoreReason).toBeNull();
    expect(vars.data.categoryConstantName).toBeNull();
    expect(vars.data.categoryValue).toBeNull();
  });

  it("includes both category fields in the payload when both are filled", async () => {
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("input-category-constant-name"), {
      target: { value: "Smoke" },
    });
    fireEvent.change(screen.getByTestId("input-category-value"), {
      target: { value: "smoke-tests" },
    });
    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    await waitFor(() => expect(startMutate).toHaveBeenCalledTimes(1));
    const vars = startMutate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(vars.data.categoryConstantName).toBe("Smoke");
    expect(vars.data.categoryValue).toBe("smoke-tests");
    expect(vars.data.ignoreReason).toBeNull();
  });

  it("blocks submit and shows an error when only one category field is filled (both-or-neither)", async () => {
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("input-category-constant-name"), {
      target: { value: "Smoke" },
    });
    // Leave the value field blank.
    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    await waitFor(() =>
      expect(screen.getByTestId("error-category-half-filled")).toBeTruthy(),
    );
    expect(startMutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("includes ignoreReason in the payload when the checkbox is ticked and a reason is entered", async () => {
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("checkbox-ignore-test"));
    fireEvent.change(screen.getByTestId("input-ignore-reason"), {
      target: { value: "Tracked by JIRA-1234" },
    });
    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    await waitFor(() => expect(startMutate).toHaveBeenCalledTimes(1));
    const vars = startMutate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(vars.data.ignoreReason).toBe("Tracked by JIRA-1234");
  });

  it("blocks submit when 'Ignore this test' is checked but the reason is blank", async () => {
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("checkbox-ignore-test"));
    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    await waitFor(() =>
      expect(screen.getByTestId("error-ignore-reason-missing")).toBeTruthy(),
    );
    expect(startMutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("renders the six dialog sections in the order: Suite target → Target method → Test Category → Browser size → Ignore (preceded by Base URL when saved URLs exist)", async () => {
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Suite target + Target method are always present; Base URL only when
    // the project has saved named URLs (mocked-empty here, so it does not
    // render).
    const suiteTarget = screen.getByTestId("section-suite-target");
    const targetMethod = screen.getByTestId("section-target-method");
    const category = screen.getByTestId("section-test-category");
    const browserSize = screen.getByTestId("section-browser-size");
    const ignore = screen.getByTestId("section-ignore-test");
    // DOCUMENT_POSITION_FOLLOWING = 4 → b appears after a.
    expect(
      suiteTarget.compareDocumentPosition(targetMethod) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      targetMethod.compareDocumentPosition(category) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      category.compareDocumentPosition(browserSize) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      browserSize.compareDocumentPosition(ignore) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("reveals the existing-suite picker when Suite target is switched to 'Add to existing test suite'", async () => {
    renderWithProviders(
      <StartRecordingDialog
        open={true}
        onOpenChange={onOpenChange}
        tests={[
          { path: "Tests/LoginTestSuite.cs", className: "LoginTestSuite" },
        ]}
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Default mode is "new" — new-class input is visible, existing-suite
    // <Select> trigger is not.
    expect(screen.getByTestId("input-new-class")).toBeTruthy();
    expect(screen.queryByTestId("select-existing-class")).toBeNull();
    // Click the "existing" radio card.
    fireEvent.click(screen.getByLabelText(/Add to existing test suite/));
    await waitFor(() =>
      expect(screen.getByTestId("select-existing-class")).toBeTruthy(),
    );
    expect(screen.queryByTestId("input-new-class")).toBeNull();
  });

  it("blocks submit and surfaces a viewport range error when width/height fall outside 320–3840 / 240–2160", async () => {
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Switch the viewport preset to "custom" so the width/height inputs
    // mount and become editable.
    const trigger = screen.getByTestId("select-viewport-preset");
    fireEvent.keyDown(trigger, { key: "Enter" });
    await waitFor(() => screen.getAllByText(/Custom/));
    fireEvent.click(screen.getByText(/Custom…/));
    const widthInput = (await screen.findByTestId(
      "input-viewport-width",
    )) as HTMLInputElement;
    const heightInput = screen.getByTestId(
      "input-viewport-height",
    ) as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: "10" } });
    fireEvent.change(heightInput, { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("button-confirm-start-recording"));
    // Validation guard fires synchronously inside the onClick handler;
    // the mutation must not be invoked and a toast error must be raised.
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(startMutate).not.toHaveBeenCalled();
  });

  it("labels the target-method radio row 'Target method' (renamed from 'Record into')", async () => {
    renderWithProviders(
      <StartRecordingDialog open={true} onOpenChange={onOpenChange} tests={[]} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const section = screen.getByTestId("section-target-method");
    expect(section.textContent).toContain("Target method");
    expect(section.textContent).not.toContain("Record into");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const listValidationRecordingsMock = vi.fn();

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@workspace/api-client-react")
  >();
  return {
    ...actual,
    listValidationRecordings: (...a: unknown[]) =>
      listValidationRecordingsMock(...a),
    startValidationRun: vi.fn(),
    startValidationRunFromSession: vi.fn(),
    startValidateAll: vi.fn(),
    validationTraceUrl: (id: string) => `/trace/${id}`,
    validationScreenshotUrl: (id: string, p: string) => `/shot/${id}/${p}`,
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// The panel renders <FixSelectorDialog>, which hides its "Fix with AI"
// tab for guest trial sessions and therefore reads the auth context.
vi.mock("@/features/auth/presentation/role", () => ({
  useIsGuest: () => false,
}));

import { ValidationPanel } from "../validation-panel";

afterEach(() => {
  cleanup();
  listValidationRecordingsMock.mockReset();
});

describe("ValidationPanel", () => {
  it("renders nothing visible when closed", () => {
    listValidationRecordingsMock.mockResolvedValue([]);
    render(<ValidationPanel open={false} onOpenChange={() => {}} />);
    // The sheet doesn't request the recordings list when closed
    expect(listValidationRecordingsMock).not.toHaveBeenCalled();
  });

  it("loads recordings when opened and shows the empty state", async () => {
    listValidationRecordingsMock.mockResolvedValue([]);
    render(<ValidationPanel open={true} onOpenChange={() => {}} />);
    await waitFor(() =>
      expect(listValidationRecordingsMock).toHaveBeenCalled(),
    );
    expect(
      screen.getByText(/No recordings stored for this project/i),
    ).toBeDefined();
  });

  it("lists each loaded recording with a friendly label", async () => {
    listValidationRecordingsMock.mockResolvedValue([
      {
        id: "r1",
        filePath: "tests/Login.cs",
        kind: "testMethod",
        methodName: "LoginAsAdmin",
      },
      {
        id: "r2",
        filePath: "tests/Setup.cs",
        kind: "beforeEach",
        methodName: null,
      },
    ]);
    render(<ValidationPanel open={true} onOpenChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/Login\.cs/)).toBeDefined(),
    );
    expect(screen.getByText(/LoginAsAdmin/)).toBeDefined();
    expect(screen.getByText(/Setup\.cs/)).toBeDefined();
  });
});

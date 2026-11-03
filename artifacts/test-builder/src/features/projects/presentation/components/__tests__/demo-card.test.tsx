import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { createMutate, navigateMock, toastSuccess, toastError } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  navigateMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, info: vi.fn(), warning: vi.fn() },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", navigateMock],
}));

let pending = false;

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useCreateDemoProject: ({
      mutation,
    }: {
      mutation: { onSuccess?: () => Promise<void> | void };
    }) => ({
      mutate: (...args: unknown[]) => {
        createMutate(...args);
        void mutation.onSuccess?.();
      },
      isPending: pending,
    }),
    getGetCurrentProjectQueryKey: () => ["currentProject"],
    getGetProjectTreeQueryKey: () => ["projectTree"],
    getListTestClassesQueryKey: () => ["listTestClasses"],
  };
});

import { DemoCard } from "../demo-card";

function renderUI() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DemoCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createMutate.mockReset();
  navigateMock.mockReset();
  toastSuccess.mockReset();
  pending = false;
});

afterEach(() => cleanup());

describe("<DemoCard />", () => {
  it("renders the call-to-action with the documented copy", () => {
    renderUI();
    expect(screen.getByTestId("card-try-the-demo")).toBeTruthy();
    expect(screen.getAllByText(/Try the demo/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/MementoDemo/)).toBeTruthy();
  });

  it("calls the demo mutation, fires success toast, and navigates to /workbench", async () => {
    renderUI();
    fireEvent.click(screen.getByTestId("button-try-demo"));
    expect(createMutate).toHaveBeenCalledTimes(1);
    // The new onSuccess flow awaits Promise.all of three React Query
    // invalidations before navigating, so wait for the side effects to
    // settle rather than counting microticks.
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Demo project ready");
      expect(navigateMock).toHaveBeenCalledWith("/workbench");
    });
  });

  it("disables the button while the mutation is pending", () => {
    pending = true;
    renderUI();
    expect(
      (screen.getByTestId("button-try-demo") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/Setting up/i)).toBeTruthy();
  });
});

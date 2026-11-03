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

const { setSeenMutate, tourState } = vi.hoisted(() => ({
  setSeenMutate: vi.fn(),
  tourState: { hasSeenTour: false as boolean | null, isLoading: false },
}));

const stableData = {
  true: { hasSeenTour: true },
  false: { hasSeenTour: false },
} as const;

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useGetTourState: () => ({
      data:
        tourState.hasSeenTour === null
          ? undefined
          : tourState.hasSeenTour
            ? stableData.true
            : stableData.false,
      isLoading: tourState.isLoading,
    }),
    useSetTourSeen: () => ({ mutate: setSeenMutate, isPending: false }),
    getGetTourStateQueryKey: () => ["tour-state"],
  };
});

import { OnboardingTour } from "../onboarding-tour";

function renderUI(props: { forceOpen?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OnboardingTour {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setSeenMutate.mockReset();
  tourState.hasSeenTour = false;
  tourState.isLoading = false;
});

afterEach(() => cleanup());

describe("<OnboardingTour />", () => {
  it("renders nothing when the user has already seen the tour", () => {
    tourState.hasSeenTour = true;
    renderUI();
    expect(screen.queryByTestId("onboarding-tour-overlay")).toBeNull();
  });

  it("auto-opens when hasSeenTour is false and walks through all 5 steps", async () => {
    renderUI();
    await waitFor(() =>
      expect(screen.getByTestId("onboarding-tour-overlay")).toBeTruthy(),
    );
    expect(screen.getByTestId("text-tour-title").textContent).toMatch(
      /Welcome to Test Builder/i,
    );

    const titles = [
      /Start a recording/i,
      /Add assertions on the fly/i,
      /Mock the network/i,
      /Validate your tests/i,
    ];
    for (const expected of titles) {
      await act(async () => {
        fireEvent.click(screen.getByTestId("button-tour-next"));
      });
      await waitFor(() =>
        expect(screen.getByTestId("text-tour-title").textContent).toMatch(expected),
      );
    }

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-tour-finish"));
    });
    expect(setSeenMutate).toHaveBeenCalledWith({ data: { hasSeenTour: true } });
    expect(screen.queryByTestId("onboarding-tour-overlay")).toBeNull();
  });

  it("Back button is disabled on step 1 and enabled after Next", async () => {
    renderUI();
    await waitFor(() =>
      expect(screen.getByTestId("onboarding-tour-overlay")).toBeTruthy(),
    );
    expect(
      (screen.getByTestId("button-tour-prev") as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-tour-next"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("text-tour-title").textContent).toMatch(
        /Start a recording/i,
      ),
    );
    expect(
      (screen.getByTestId("button-tour-prev") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("Close (X) marks the tour seen", async () => {
    renderUI();
    await waitFor(() =>
      expect(screen.getByTestId("onboarding-tour-overlay")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-tour-close"));
    });
    expect(setSeenMutate).toHaveBeenCalledWith({ data: { hasSeenTour: true } });
  });

  it("forceOpen=true reopens the tour even when hasSeenTour is true", async () => {
    tourState.hasSeenTour = true;
    renderUI({ forceOpen: true });
    await waitFor(() =>
      expect(screen.getByTestId("onboarding-tour-overlay")).toBeTruthy(),
    );
  });
});

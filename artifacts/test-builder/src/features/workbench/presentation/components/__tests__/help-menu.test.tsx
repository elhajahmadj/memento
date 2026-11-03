import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { setSeenMutate } = vi.hoisted(() => ({
  setSeenMutate: vi.fn(),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSetTourSeen: () => ({ mutate: setSeenMutate, isPending: false }),
    getGetTourStateQueryKey: () => ["tour-state"],
  };
});

// Radix's DropdownMenu uses portals + pointer events that JSDOM does not
// fully implement, so swap it for inline shells that always render their
// children. We're testing the wiring of the menu item, not Radix.
vi.mock("@/shared/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children);
  const Item = ({
    children,
    onClick,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement(
      "button",
      { type: "button", onClick, ...rest },
      children,
    );
  const Trigger = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuTrigger: Trigger,
    DropdownMenuItem: Item,
  };
});

import { HelpMenu } from "../help-menu";

function renderUI() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HelpMenu />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setSeenMutate.mockReset();
});

afterEach(() => cleanup());

describe("<HelpMenu />", () => {
  it("clicking 'Replay onboarding tour' resets the seen flag and dispatches the relaunch event", async () => {
    const relaunchSpy = vi.fn();
    window.addEventListener("onboarding:relaunch", relaunchSpy);
    try {
      renderUI();
      const item = screen.getByTestId("menu-item-replay-tour");
      await act(async () => {
        fireEvent.click(item);
      });
      expect(setSeenMutate).toHaveBeenCalledWith({
        data: { hasSeenTour: false },
      });
      expect(relaunchSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("onboarding:relaunch", relaunchSpy);
    }
  });
});

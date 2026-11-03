import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const navigateMock = vi.fn();
const useReducedMotionMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/splash", navigateMock],
}));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useReducedMotion: () => useReducedMotionMock(),
  };
});

import { Splash } from "../splash";

/**
 * Drive the splash's `?next=` lookup by stubbing `window.location` to
 * a URL with the desired query string. jsdom defaults to
 * `http://localhost:3000/` and rejects `history.replaceState` calls
 * that change the origin, so we replace the whole `location` object
 * with a minimal stub that only needs to satisfy `new URL(href)`.
 */
function setSearch(search: string) {
  const href = `http://localhost:3000/splash${search}`;
  vi.stubGlobal("location", { ...window.location, href, search });
}

beforeEach(() => {
  vi.useFakeTimers();
  navigateMock.mockReset();
  useReducedMotionMock.mockReset();
  setSearch("");
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
});

describe("<Splash />", () => {
  it("renders the splash screen with the brand and tagline", () => {
    useReducedMotionMock.mockReturnValue(true);
    render(<Splash />);
    expect(screen.getByTestId("screen-splash")).toBeDefined();
    expect(screen.getByTestId("splash-tagline")).toBeDefined();
    expect(screen.getByTestId("splash-tagline-record").textContent).toBe(
      "Record.",
    );
    expect(screen.getByTestId("splash-tagline-build").textContent).toBe(
      "Build.",
    );
  });

  it("navigates to '/' quickly when the user prefers reduced motion", () => {
    useReducedMotionMock.mockReturnValue(true);
    render(<Splash />);
    expect(navigateMock).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
  });

  it("honors a same-origin '?next=' under reduced motion", () => {
    setSearch("?next=%2Fdashboard");
    useReducedMotionMock.mockReturnValue(true);
    render(<Splash />);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(navigateMock).toHaveBeenCalledWith("/dashboard", { replace: true });
  });

  it("falls back to '/' when '?next=' is protocol-relative (open-redirect guard)", () => {
    setSearch("?next=%2F%2Fevil.example.com%2Fx");
    useReducedMotionMock.mockReturnValue(true);
    render(<Splash />);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
  });

  it("falls back to '/' when '?next=' is an absolute URL", () => {
    setSearch("?next=https%3A%2F%2Fevil.example.com");
    useReducedMotionMock.mockReturnValue(true);
    render(<Splash />);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
  });

  it("renders a static rotated glyph when reduced motion is on", () => {
    useReducedMotionMock.mockReturnValue(true);
    render(<Splash />);
    expect(screen.getByTestId("splash-glyph-static")).toBeDefined();
  });

  it("eventually navigates to / in the full animated path too", () => {
    useReducedMotionMock.mockReturnValue(false);
    render(<Splash />);
    expect(navigateMock).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(3300);
    });
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
  });
});

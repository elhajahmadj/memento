import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useIsMobile } from "../use-mobile";

type MqlListener = (ev: MediaQueryListEvent) => void;

interface FakeMql {
  matches: boolean;
  addEventListener: (t: "change", l: MqlListener) => void;
  removeEventListener: (t: "change", l: MqlListener) => void;
  fire: () => void;
}

function installMatchMedia(initialMatches: boolean): FakeMql {
  const listeners: MqlListener[] = [];
  const mql: FakeMql = {
    matches: initialMatches,
    addEventListener: (_t, l) => {
      listeners.push(l);
    },
    removeEventListener: (_t, l) => {
      const i = listeners.indexOf(l);
      if (i >= 0) listeners.splice(i, 1);
    },
    fire: () => {
      for (const l of listeners) l({} as MediaQueryListEvent);
    },
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue(mql),
  });
  return mql;
}

function setInnerWidth(w: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: w,
  });
}

afterEach(() => {
  cleanup();
});

describe("useIsMobile", () => {
  it("returns true when innerWidth is below the 768px breakpoint", () => {
    installMatchMedia(true);
    setInnerWidth(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("returns false when innerWidth is at or above the breakpoint", () => {
    installMatchMedia(false);
    setInnerWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("re-evaluates when the media query change event fires", () => {
    const mql = installMatchMedia(false);
    setInnerWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    setInnerWidth(400);
    act(() => {
      mql.fire();
    });
    expect(result.current).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePanelLayout } from "../usePanelLayout";

const OPTS = {
  collapsedKey: "test.panel.collapsed",
  widthKey: "test.panel.width",
  defaultWidth: 20,
  minWidth: 15,
  maxWidth: 35,
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("usePanelLayout", () => {
  it("defaults to expanded with the provided default width", () => {
    const { result } = renderHook(() => usePanelLayout(OPTS));
    expect(result.current.collapsed).toBe(false);
    expect(result.current.defaultWidth).toBe(20);
  });

  it("hydrates collapsed flag from localStorage", () => {
    window.localStorage.setItem(OPTS.collapsedKey, "1");
    const { result } = renderHook(() => usePanelLayout(OPTS));
    expect(result.current.collapsed).toBe(true);
  });

  it("hydrates width from localStorage when within bounds", () => {
    window.localStorage.setItem(OPTS.widthKey, "28");
    const { result } = renderHook(() => usePanelLayout(OPTS));
    expect(result.current.defaultWidth).toBe(28);
  });

  it("ignores persisted widths outside the allowed range", () => {
    window.localStorage.setItem(OPTS.widthKey, "9999");
    const { result } = renderHook(() => usePanelLayout(OPTS));
    expect(result.current.defaultWidth).toBe(20);
  });

  it("persists the collapsed flag whenever it changes", () => {
    const { result } = renderHook(() => usePanelLayout(OPTS));
    act(() => result.current.onCollapse());
    expect(result.current.collapsed).toBe(true);
    expect(window.localStorage.getItem(OPTS.collapsedKey)).toBe("1");
    act(() => result.current.onExpand());
    expect(window.localStorage.getItem(OPTS.collapsedKey)).toBe("0");
  });

  it("persists onResize sizes but ignores 0 (collapse signal)", () => {
    const { result } = renderHook(() => usePanelLayout(OPTS));
    act(() => result.current.onResize(27));
    expect(window.localStorage.getItem(OPTS.widthKey)).toBe("27");
    act(() => result.current.onResize(0));
    expect(window.localStorage.getItem(OPTS.widthKey)).toBe("27");
  });
});

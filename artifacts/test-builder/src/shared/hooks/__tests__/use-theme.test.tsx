import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ThemeProvider, useIsDarkTheme, useTheme } from "../use-theme";
import { type ReactNode } from "react";

const STORAGE_KEY = "test-builder-theme";

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark", "grey");
});

afterEach(() => {
  cleanup();
});

describe("useTheme", () => {
  it("defaults to dark and applies the dark class to <html>", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("dark");
    expect(result.current.isDark).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("grey")).toBe(false);
  });

  it("hydrates from localStorage when a known theme is stored", () => {
    window.localStorage.setItem(STORAGE_KEY, "light");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("light");
    expect(result.current.isDark).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("grey")).toBe(false);
  });

  it("setTheme updates state, the <html> class, and persists to localStorage", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => {
      result.current.setTheme("grey");
    });
    expect(result.current.theme).toBe("grey");
    expect(document.documentElement.classList.contains("grey")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("grey");
  });

  it("toggleTheme cycles dark → light → grey → dark", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("dark");
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("light");
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("grey");
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("useIsDarkTheme tracks the active theme", () => {
    const { result } = renderHook(
      () => ({ all: useTheme(), dark: useIsDarkTheme() }),
      { wrapper },
    );
    expect(result.current.dark).toBe(true);
    act(() => result.current.all.setTheme("light"));
    expect(result.current.dark).toBe(false);
  });

  it("useTheme throws when used without a ThemeProvider", () => {
    expect(() => renderHook(() => useTheme())).toThrow(/ThemeProvider/);
  });
});

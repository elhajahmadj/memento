/**
 * RTL specs for the Appearance section's "Navigation layout" radios.
 *
 * Covers the three pieces the layout-preference feature can silently
 * regress on:
 *  - both options render with the right labels,
 *  - "Top bar" is the selected option for a fresh user (default value
 *    coming back from the server is `top`),
 *  - selecting "Side nav" calls the `setLayout` mutation with the
 *    matching payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const setLayout = vi.fn();
const setTheme = vi.fn();
let currentLayout: "top" | "side" = "top";

vi.mock("@/shared/hooks/use-theme", () => ({
  useTheme: () => ({
    theme: "dark",
    isDark: true,
    setTheme,
    toggleTheme: vi.fn(),
  }),
}));

vi.mock("@/shared/hooks/use-nav-layout", () => ({
  useNavLayout: () => ({
    layout: currentLayout,
    setLayout,
    loading: false,
  }),
}));

import { AppearanceSection } from "../appearance-section";

beforeEach(() => {
  setLayout.mockReset();
  setTheme.mockReset();
  currentLayout = "top";
});

afterEach(() => cleanup());

describe("<AppearanceSection /> — Navigation layout", () => {
  it("renders both nav-layout options with their labels", () => {
    render(<AppearanceSection />);
    expect(screen.getByTestId("radio-nav-layout-top")).toBeDefined();
    expect(screen.getByTestId("radio-nav-layout-side")).toBeDefined();
    expect(screen.getByText("Top bar")).toBeDefined();
    expect(screen.getByText("Side nav")).toBeDefined();
  });

  it("selects 'Top bar' by default for a fresh user", () => {
    currentLayout = "top";
    render(<AppearanceSection />);
    const topRadio = screen.getByTestId("radio-nav-layout-top");
    const sideRadio = screen.getByTestId("radio-nav-layout-side");
    expect(topRadio.getAttribute("aria-checked")).toBe("true");
    expect(sideRadio.getAttribute("aria-checked")).toBe("false");
  });

  it("reflects the persisted 'side' value when the user has already opted in", () => {
    currentLayout = "side";
    render(<AppearanceSection />);
    expect(
      screen.getByTestId("radio-nav-layout-side").getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByTestId("radio-nav-layout-top").getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("calls setLayout('side') when the user picks the side-nav option", () => {
    render(<AppearanceSection />);
    fireEvent.click(screen.getByTestId("radio-nav-layout-side"));
    expect(setLayout).toHaveBeenCalledTimes(1);
    expect(setLayout).toHaveBeenCalledWith("side");
  });

  it("calls setLayout('top') when the user switches back to the top bar", () => {
    currentLayout = "side";
    render(<AppearanceSection />);
    fireEvent.click(screen.getByTestId("radio-nav-layout-top"));
    expect(setLayout).toHaveBeenCalledTimes(1);
    expect(setLayout).toHaveBeenCalledWith("top");
  });
});

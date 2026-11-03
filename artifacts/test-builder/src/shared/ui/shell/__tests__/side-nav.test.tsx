/**
 * Specs for <SideNavLayout /> mirroring the top-nav coverage:
 * verifies destination parity, role-gated admin items, and
 * active-route highlighting via `aria-current=page`. Together with
 * top-nav.test.tsx this proves the two layouts ship the same nav.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AuthUserRole } from "@workspace/api-client-react";
import { SideNavLayout } from "../side-nav";

const useAuthMock = vi.fn();
vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/features/auth/presentation/user-menu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

function setRole(role: AuthUserRole | null) {
  useAuthMock.mockReturnValue({
    user: role
      ? {
          id: "u1",
          username: "u",
          role,
          effectiveRole: role,
          firstName: "U",
          lastName: "U",
          title: "T",
          email: "u@u.com",
          profileComplete: true,
        }
      : null,
    loading: false,
    logout: vi.fn(),
  });
}

function renderAt(path: string) {
  const memory = memoryLocation({ path, record: true });
  return render(
    <Router hook={memory.hook}>
      <SideNavLayout>
        <div data-testid="page-content">hello</div>
      </SideNavLayout>
    </Router>,
  );
}

beforeAll(() => {
  // The shared Sidebar primitive reads window.matchMedia via the
  // use-mobile hook; jsdom doesn't ship one, so stub it to never
  // match.
  if (typeof window !== "undefined" && !window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
});

describe("SideNavLayout", () => {
  it("always shows the core nav links (Projects, Workstation, Settings, Documentation)", () => {
    setRole("limited");
    renderAt("/");
    expect(screen.getByTestId("side-nav-link-projects")).toBeDefined();
    expect(screen.getByTestId("side-nav-link-workstation")).toBeDefined();
    expect(screen.getByTestId("side-nav-link-settings")).toBeDefined();
    expect(screen.getByTestId("side-nav-link-documentation")).toBeDefined();
  });

  it("hides the admin-only Tools and Admin links from limited users", () => {
    setRole("limited");
    renderAt("/");
    expect(screen.queryByTestId("side-nav-link-tools")).toBeNull();
    expect(screen.queryByTestId("side-nav-link-admin")).toBeNull();
  });

  it("shows Tools and Admin for admin users", () => {
    setRole("admin");
    renderAt("/");
    expect(screen.getByTestId("side-nav-link-tools")).toBeDefined();
    expect(screen.getByTestId("side-nav-link-admin")).toBeDefined();
  });

  it("shows Tools and Admin for limited_admin users", () => {
    setRole("limited_admin");
    renderAt("/");
    expect(screen.getByTestId("side-nav-link-tools")).toBeDefined();
    expect(screen.getByTestId("side-nav-link-admin")).toBeDefined();
  });

  it("highlights the Admin link when on an /admin route", () => {
    setRole("admin");
    renderAt("/admin");
    // SidebarMenuButton uses Radix's `asChild` pattern, so the
    // testid + aria-current end up on the rendered <a> directly.
    expect(
      screen.getByTestId("side-nav-link-admin").getAttribute("aria-current"),
    ).toBe("page");
  });

  it("marks the active link with aria-current=page and leaves the others unset", () => {
    setRole("admin");
    renderAt("/settings");
    expect(
      screen
        .getByTestId("side-nav-link-settings")
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByTestId("side-nav-link-projects")
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("matches active link by prefix (e.g. /tools/foo highlights Tools)", () => {
    setRole("admin");
    renderAt("/tools/approval");
    expect(
      screen.getByTestId("side-nav-link-tools").getAttribute("aria-current"),
    ).toBe("page");
  });

  it("renders the page content alongside the side nav", () => {
    setRole("admin");
    renderAt("/");
    expect(screen.getByTestId("side-nav")).toBeDefined();
    expect(screen.getByTestId("page-content")).toBeDefined();
  });
});

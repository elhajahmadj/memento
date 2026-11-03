/**
 * Specs for <PageShell />. Renders the *real* TopNav and SideNavLayout
 * so the assertions exercise actual nav behavior, not stubs. Verifies:
 *  - layout="top" renders the top bar and not the side nav,
 *  - layout=undefined (unset / hook fallback) renders the top bar
 *    (proves the default-preference path),
 *  - layout="side" renders the side nav and not the top bar,
 *  - destination parity: both layouts expose the same set of links
 *    for the same signed-in user,
 *  - active-route highlighting parity: the same `aria-current=page`
 *    link shows up in either layout for the same URL.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AuthUserRole } from "@workspace/api-client-react";

let currentLayout: "top" | "side" | undefined = "top";

vi.mock("@/shared/hooks/use-nav-layout", () => ({
  useNavLayout: () => ({
    // Cast to satisfy the hook's typed return — undefined exercises
    // the page shell's fallback path.
    layout: currentLayout as "top" | "side",
    setLayout: vi.fn(),
    loading: false,
  }),
}));

const useAuthMock = vi.fn();
vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock(
  "@/features/approvals/presentation/components/notification-bell",
  () => ({
    NotificationBell: () => <div data-testid="notification-bell" />,
  }),
);

vi.mock("@/features/auth/presentation/user-menu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

vi.mock("@/shared/hooks/use-theme", () => ({
  useTheme: () => ({
    theme: "dark",
    isDark: true,
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

import { PageShell } from "../page-shell";

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

function renderShellAt(path: string) {
  const memory = memoryLocation({ path, record: true });
  return render(
    <Router hook={memory.hook}>
      <PageShell showBack={false}>
        <div data-testid="page-content">hello</div>
      </PageShell>
    </Router>,
  );
}

beforeAll(() => {
  // The shared Sidebar primitive (used by SideNavLayout) reads
  // window.matchMedia via the use-mobile hook; jsdom doesn't ship
  // one, so stub it to never match.
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

beforeEach(() => {
  currentLayout = "top";
  setRole("admin");
});

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
});

describe("<PageShell />", () => {
  it("renders the top bar when the preference is 'top'", () => {
    currentLayout = "top";
    renderShellAt("/");
    // Top-bar nav links are present; side-nav variant is not.
    expect(screen.getByTestId("nav-link-projects")).toBeDefined();
    expect(screen.queryByTestId("side-nav")).toBeNull();
    expect(screen.getByTestId("page-content")).toBeDefined();
  });

  it("falls back to the top bar when the preference is unset / undefined", () => {
    // Exercises the `layout === 'side'` short-circuit in page-shell:
    // any non-'side' value (including undefined from a hook that
    // hasn't loaded yet, or a missing provider) renders the top bar.
    currentLayout = undefined;
    renderShellAt("/");
    expect(screen.getByTestId("nav-link-projects")).toBeDefined();
    expect(screen.queryByTestId("side-nav")).toBeNull();
  });

  it("renders the side nav (and not the top bar) when the preference is 'side'", () => {
    currentLayout = "side";
    renderShellAt("/");
    expect(screen.getByTestId("side-nav")).toBeDefined();
    expect(screen.getByTestId("side-nav-link-projects")).toBeDefined();
    // The top-bar `nav-link-*` testids must not appear in side mode.
    expect(screen.queryByTestId("nav-link-projects")).toBeNull();
    expect(screen.getByTestId("page-content")).toBeDefined();
  });

  it("exposes the same destinations in both layouts for an admin user", () => {
    const expected = [
      "projects",
      "workstation",
      "admin",
      "tools",
      "settings",
      "documentation",
    ];

    currentLayout = "top";
    renderShellAt("/");
    for (const slug of expected) {
      expect(
        screen.getByTestId(`nav-link-${slug}`),
        `top: nav-link-${slug}`,
      ).toBeDefined();
    }
    cleanup();

    currentLayout = "side";
    renderShellAt("/");
    for (const slug of expected) {
      expect(
        screen.getByTestId(`side-nav-link-${slug}`),
        `side: side-nav-link-${slug}`,
      ).toBeDefined();
    }
  });

  it("hides admin-only destinations from limited users in both layouts", () => {
    setRole("limited");

    currentLayout = "top";
    renderShellAt("/");
    expect(screen.queryByTestId("nav-link-admin")).toBeNull();
    expect(screen.queryByTestId("nav-link-tools")).toBeNull();
    cleanup();

    currentLayout = "side";
    renderShellAt("/");
    expect(screen.queryByTestId("side-nav-link-admin")).toBeNull();
    expect(screen.queryByTestId("side-nav-link-tools")).toBeNull();
  });

  it("highlights the same active link in both layouts for the same URL", () => {
    currentLayout = "top";
    renderShellAt("/settings");
    const topActive = screen.getByTestId("nav-link-settings");
    expect(topActive.getAttribute("aria-current")).toBe("page");
    expect(
      screen.getByTestId("nav-link-projects").getAttribute("aria-current"),
    ).toBeNull();
    cleanup();

    currentLayout = "side";
    renderShellAt("/settings");
    // SidebarMenuButton uses the asChild pattern, so the testid +
    // aria-current end up on the rendered <a> directly.
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
});

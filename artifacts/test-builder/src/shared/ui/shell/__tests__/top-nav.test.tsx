import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AuthUserRole } from "@workspace/api-client-react";
import { TopNav } from "../top-nav";

const useAuthMock = vi.fn();
vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/features/approvals/presentation/components/notification-bell", () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

vi.mock("@/features/auth/presentation/user-menu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

vi.mock("@/shared/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "dark", isDark: true, setTheme: vi.fn(), toggleTheme: vi.fn() }),
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
      <TopNav />
    </Router>,
  );
}

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
});

describe("TopNav", () => {
  it("always shows the core nav links (Home, Projects, Workstation, Settings, Documentation, About)", () => {
    setRole("limited");
    renderAt("/");
    expect(screen.getByTestId("nav-link-home")).toBeDefined();
    expect(screen.getByTestId("nav-link-projects")).toBeDefined();
    expect(screen.getByTestId("nav-link-workstation")).toBeDefined();
    expect(screen.getByTestId("nav-link-settings")).toBeDefined();
    expect(screen.getByTestId("nav-link-documentation")).toBeDefined();
    expect(screen.getByTestId("nav-link-about")).toBeDefined();
  });

  it("still hides Admin and Tools from guests", () => {
    setRole("guest");
    renderAt("/");
    expect(screen.queryByTestId("nav-link-admin")).toBeNull();
    expect(screen.queryByTestId("nav-link-tools")).toBeNull();
  });

  it("renders Home first, then Projects in the nav order", () => {
    setRole("limited");
    renderAt("/");
    const links = screen.getAllByRole("link");
    const labels = links
      .map((a) => a.getAttribute("data-testid"))
      .filter((id): id is string => !!id && id.startsWith("nav-link-"));
    const homeIdx = labels.indexOf("nav-link-home");
    const projectsIdx = labels.indexOf("nav-link-projects");
    expect(homeIdx).toBeGreaterThanOrEqual(0);
    expect(projectsIdx).toBeGreaterThan(homeIdx);
  });

  it("highlights Home on '/' and not on '/projects'", () => {
    setRole("admin");
    renderAt("/");
    expect(
      screen.getByTestId("nav-link-home").getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByTestId("nav-link-projects").getAttribute("aria-current"),
    ).toBeNull();
  });

  it("highlights Projects on '/projects' and not Home", () => {
    setRole("admin");
    renderAt("/projects");
    expect(
      screen.getByTestId("nav-link-projects").getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByTestId("nav-link-home").getAttribute("aria-current"),
    ).toBeNull();
  });

  it("hides the admin-only Tools and Admin links from limited users", () => {
    setRole("limited");
    renderAt("/");
    expect(screen.queryByTestId("nav-link-tools")).toBeNull();
    expect(screen.queryByTestId("nav-link-admin")).toBeNull();
  });

  it("shows Tools and Admin for admin users", () => {
    setRole("admin");
    renderAt("/");
    expect(screen.getByTestId("nav-link-tools")).toBeDefined();
    expect(screen.getByTestId("nav-link-admin")).toBeDefined();
  });

  it("shows Tools and Admin for limited_admin users", () => {
    setRole("limited_admin");
    renderAt("/");
    expect(screen.getByTestId("nav-link-tools")).toBeDefined();
    expect(screen.getByTestId("nav-link-admin")).toBeDefined();
  });

  it("highlights the Admin link when on an /admin route", () => {
    setRole("admin");
    renderAt("/admin");
    expect(screen.getByTestId("nav-link-admin").getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("marks the active link with aria-current=page", () => {
    setRole("admin");
    renderAt("/settings");
    const settings = screen.getByTestId("nav-link-settings");
    expect(settings.getAttribute("aria-current")).toBe("page");
    const home = screen.getByTestId("nav-link-home");
    expect(home.getAttribute("aria-current")).toBeNull();
  });

  it("matches active link by prefix (e.g. /tools/foo highlights Tools)", () => {
    setRole("admin");
    renderAt("/tools/approval");
    expect(screen.getByTestId("nav-link-tools").getAttribute("aria-current")).toBe(
      "page",
    );
  });
});

describe("TopNav — guest surface", () => {
  it("hides Home, Settings and Documentation from guests", () => {
    // All three either dead-end or are closed server-side for a guest:
    // `/` redirects to /projects, Settings would show only Appearance,
    // and Documentation is not part of the trial.
    setRole("guest");
    renderAt("/projects");
    expect(screen.queryByTestId("nav-link-home")).toBeNull();
    expect(screen.queryByTestId("nav-link-settings")).toBeNull();
    expect(screen.queryByTestId("nav-link-documentation")).toBeNull();
  });

  it("leaves guests with Projects and Workstation", () => {
    setRole("guest");
    renderAt("/projects");
    expect(screen.getByTestId("nav-link-projects")).toBeDefined();
    expect(screen.getByTestId("nav-link-workstation")).toBeDefined();
  });

  it("still shows Settings and Documentation to a regular user", () => {
    setRole("limited");
    renderAt("/projects");
    expect(screen.getByTestId("nav-link-settings")).toBeDefined();
    expect(screen.getByTestId("nav-link-documentation")).toBeDefined();
  });
});

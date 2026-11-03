import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import type { AuthUserRole } from "@workspace/api-client-react";

const useAuthMock = vi.fn();
let currentLocation = "/documentation";
const navigateMock = vi.fn((to: string, _opts?: unknown) => {
  currentLocation = to;
});
let currentParams: { sectionId?: string } = {};

vi.mock("wouter", () => ({
  useLocation: () => [currentLocation, navigateMock],
  useParams: () => currentParams,
  Link: ({
    children,
    href,
    ...rest
  }: { children: ReactNode; href?: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/shared/hooks/use-theme", () => ({
  useTheme: () => ({
    theme: "dark",
    isDark: true,
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
  useIsDarkTheme: () => true,
}));

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/features/approvals/presentation/components/notification-bell", () => ({
  NotificationBell: () => <div data-testid="bell" />,
}));

vi.mock("@/features/auth/presentation/user-menu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

import { Documentation } from "../documentation";

function setRole(role: AuthUserRole | null) {
  useAuthMock.mockReturnValue({
    user: role
      ? { id: "u", username: "u", role, effectiveRole: role, profileComplete: true }
      : null,
    loading: false,
    logout: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
  navigateMock.mockClear();
  currentParams = {};
  currentLocation = "/documentation";
});

describe("<Documentation />", () => {
  it("shows the empty state when no user is signed in", () => {
    setRole(null);
    render(<Documentation />);
    expect(screen.getByTestId("documentation-empty")).toBeDefined();
    expect(screen.queryByTestId("documentation-sidebar")).toBeNull();
  });

  it("renders the sidebar + main layout for signed-in users", () => {
    setRole("admin");
    currentParams = { sectionId: "home" };
    currentLocation = "/documentation/home";
    render(<Documentation />);
    expect(screen.getByTestId("documentation-layout")).toBeDefined();
    expect(screen.getByTestId("documentation-sidebar")).toBeDefined();
    expect(screen.getByTestId("documentation-main")).toBeDefined();
  });

  it("admin sidebar lists admin-only Admin/Tools entries", () => {
    setRole("admin");
    currentParams = { sectionId: "home" };
    render(<Documentation />);
    expect(
      screen.getByTestId("documentation-nav-admin-project-assignments"),
    ).toBeDefined();
    expect(
      screen.getByTestId("documentation-nav-tools-validation-traces"),
    ).toBeDefined();
  });

  it("limited_admin sidebar omits admin-only Admin/Tools entries", () => {
    setRole("limited_admin");
    currentParams = { sectionId: "home" };
    render(<Documentation />);
    expect(screen.getByTestId("documentation-nav-admin-approval")).toBeDefined();
    expect(
      screen.queryByTestId("documentation-nav-admin-project-assignments"),
    ).toBeNull();
    expect(
      screen.queryByTestId("documentation-nav-admin-git-repos"),
    ).toBeNull();
    expect(
      screen.queryByTestId("documentation-nav-tools-validation-traces"),
    ).toBeNull();
  });

  it("limited (User) sidebar shows my-approvals and hides Settings", () => {
    setRole("limited");
    currentParams = { sectionId: "home" };
    render(<Documentation />);
    expect(screen.getByTestId("documentation-nav-my-approvals")).toBeDefined();
    expect(
      screen.queryByTestId("documentation-nav-settings-architectures"),
    ).toBeNull();
    expect(screen.queryByTestId("documentation-nav-tools")).toBeNull();
  });

  it("renders the active section's heading, walkthrough, fields, and permissions", () => {
    setRole("admin");
    currentParams = { sectionId: "settings-architectures" };
    currentLocation = "/documentation/settings-architectures";
    render(<Documentation />);
    expect(
      screen.getByTestId("documentation-section-settings-architectures"),
    ).toBeDefined();
    expect(
      screen.getByTestId("documentation-heading-settings-architectures")
        .textContent,
    ).toMatch(/Architectures/);
    expect(
      screen.getByTestId("documentation-walkthrough-settings-architectures"),
    ).toBeDefined();
    expect(
      screen.getByTestId("documentation-fields-settings-architectures"),
    ).toBeDefined();
    expect(
      screen.getByTestId("documentation-permissions-settings-architectures")
        .textContent,
    ).toMatch(/Memento Admin and Admin/);
  });

  it("uses the viewer's role in the screenshot URL", () => {
    setRole("limited");
    currentParams = { sectionId: "home" };
    render(<Documentation />);
    const img = screen.getByTestId(
      "documentation-screenshot-img-home",
    ) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/images/docs/limited/home.jpg");
  });

  it("redirects /documentation to a default section when no id is provided", () => {
    setRole("admin");
    currentParams = {};
    currentLocation = "/documentation";
    render(<Documentation />);
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/documentation\/home$/),
      expect.any(Object),
    );
  });

  it("redirects when the requested section is not visible to the viewer", () => {
    setRole("limited");
    currentParams = { sectionId: "settings-architectures" };
    currentLocation = "/documentation/settings-architectures";
    render(<Documentation />);
    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1);
    expect(lastCall?.[0]).not.toBe("/documentation/settings-architectures");
  });

  it("renders the page title and back button", () => {
    setRole("admin");
    currentParams = { sectionId: "home" };
    render(<Documentation />);
    expect(
      screen.getByTestId("text-documentation-title").textContent,
    ).toBe("Documentation");
    expect(screen.getByTestId("button-documentation-back")).toBeDefined();
  });
});

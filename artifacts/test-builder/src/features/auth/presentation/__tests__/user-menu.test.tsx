import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AuthUser } from "@workspace/api-client-react";
import { UserMenu } from "../user-menu";

const useAuthMock = vi.fn();
const logoutMock = vi.fn().mockResolvedValue(undefined);
const toggleThemeMock = vi.fn();

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/shared/hooks/use-theme", () => ({
  useTheme: () => ({
    theme: "dark",
    isDark: true,
    setTheme: vi.fn(),
    toggleTheme: toggleThemeMock,
  }),
}));

vi.mock("@/features/approvals/presentation/components/notification-bell", () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

function setUser(user: AuthUser | null) {
  useAuthMock.mockReturnValue({
    user,
    loading: false,
    logout: logoutMock,
    organizations: [],
    activeOrganizationId: null,
    setActiveOrganization: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
  });
}

function renderMenu(initialPath = "/") {
  const memory = memoryLocation({ path: initialPath, record: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <Router hook={memory.hook}>
        <UserMenu />
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, memory, qc };
}

const ALICE: AuthUser = {
  id: "u1",
  username: "alice",
  role: "admin",
  firstName: "Alice",
  lastName: "Anderson",
  title: "QA",
  email: "alice@x.com",
  profileComplete: true,
  authSource: "local",
};

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
  logoutMock.mockClear();
  toggleThemeMock.mockClear();
});

describe("UserMenu", () => {
  it("renders nothing when there is no signed-in user", () => {
    setUser(null);
    const { container } = renderMenu();
    expect(container.textContent).toBe("");
  });

  it("displays the user's first + last name when the profile is complete", () => {
    setUser(ALICE);
    renderMenu();
    expect(screen.getByTestId("text-current-user").textContent).toBe(
      "Alice Anderson",
    );
  });

  it("falls back to the username when the profile is not complete", () => {
    setUser({ ...ALICE, profileComplete: false });
    renderMenu();
    expect(screen.getByTestId("text-current-user").textContent).toBe("alice");
  });

  it("clicking the theme button calls toggleTheme", () => {
    setUser(ALICE);
    renderMenu();
    fireEvent.click(screen.getByTestId("button-toggle-theme"));
    expect(toggleThemeMock).toHaveBeenCalledTimes(1);
  });

  it("renders the user menu trigger button when signed in", () => {
    setUser(ALICE);
    renderMenu();
    expect(screen.getByTestId("button-user-menu")).toBeDefined();
  });

  it("hides the Organization section for local users (no organizations)", () => {
    // Local username/password users never have user_organizations rows,
    // so /auth/me returns `organizations: []` and the switcher block
    // disappears entirely.
    setUser(ALICE);
    renderMenu();
    fireEvent.click(screen.getByTestId("button-user-menu"));
    expect(screen.queryByTestId("org-switcher-label")).toBeNull();
  });
});

describe("UserMenu — guest surface", () => {
  const GUEST: AuthUser = {
    ...ALICE,
    username: "guest-abc123",
    role: "guest",
    effectiveRole: "guest",
    authSource: "guest",
  };

  /**
   * Radix only mounts the portalled menu content once the trigger is
   * activated, and `fireEvent.click` alone doesn't do it — the trigger
   * opens on pointer/keyboard events. Keyboard activation works under
   * jsdom, which matters here: without actually opening the menu, a
   * `queryByTestId(...)).toBeNull()` assertion would pass no matter
   * what the component renders.
   */
  function openMenu() {
    fireEvent.keyDown(screen.getByTestId("button-user-menu"), { key: "Enter" });
  }

  it("shows My profile and Take the tour to a regular user", () => {
    // Positive control for the two assertions below.
    setUser({ ...ALICE, effectiveRole: "admin" });
    renderMenu();
    openMenu();
    expect(screen.getByTestId("menu-item-my-profile")).toBeDefined();
    expect(screen.getByTestId("menu-item-take-tour")).toBeDefined();
  });

  it("hides My profile from a guest", () => {
    // The identity is a throwaway `guest-<token>` with a placeholder
    // name and email; both tabs on the page (profile edit, password
    // reset) are closed to guests server-side.
    setUser(GUEST);
    renderMenu();
    openMenu();
    expect(screen.queryByTestId("menu-item-my-profile")).toBeNull();
  });

  it("hides Take the tour from a guest", () => {
    setUser(GUEST);
    renderMenu();
    openMenu();
    expect(screen.queryByTestId("menu-item-take-tour")).toBeNull();
  });

  it("still offers Sign out to a guest", () => {
    // Guests must be able to end the trial and reach the login form.
    setUser(GUEST);
    renderMenu();
    openMenu();
    expect(screen.getByTestId("button-sign-out")).toBeDefined();
  });
});

describe("UserMenu — per-org roles smoke test", () => {
  it("renders without error for an SSO user with multiple per-org roles", () => {
    // Smoke test for the per-org roles contract: an SSO user who is
    // Admin in OrgA and Limited Admin in OrgB must render the menu
    // (with the trigger visible and the user name shown) without
    // throwing. Asserting the contents of the Radix dropdown is
    // covered at the role-gating level (see role.test.tsx) because
    // Radix's portal-mounted content doesn't open under jsdom
    // without a real pointer event simulator.
    useAuthMock.mockReturnValue({
      user: {
        ...ALICE,
        role: "limited",
        effectiveRole: "admin",
      },
      loading: false,
      logout: logoutMock,
      organizations: [
        {
          id: "org-a",
          externalKey: "org-a",
          displayName: "OrgA",
          role: "admin",
        },
        {
          id: "org-b",
          externalKey: "org-b",
          displayName: "OrgB",
          role: "limited_admin",
        },
      ],
      activeOrganizationId: "org-a",
      setActiveOrganization: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
    });
    const memory = memoryLocation({ path: "/", record: true });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <Router hook={memory.hook}>
          <UserMenu />
        </Router>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("button-user-menu")).toBeDefined();
    expect(screen.getByTestId("text-current-user").textContent).toBe(
      "Alice Anderson",
    );
  });
});

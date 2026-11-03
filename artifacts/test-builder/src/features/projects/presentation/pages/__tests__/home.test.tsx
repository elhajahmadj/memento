import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthUserRole } from "@workspace/api-client-react";

const navigateMock = vi.fn();
const useAuthMock = vi.fn();
const listAvailableForkProjectsMock = vi.fn();
const listMyApprovalsMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/", navigateMock],
  Link: ({ children, href, ...rest }: { children: ReactNode; href?: string } & Record<string, unknown>) =>
    <a href={href} {...rest}>{children}</a>,
}));

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/shared/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "dark", isDark: true, setTheme: vi.fn(), toggleTheme: vi.fn() }),
  useIsDarkTheme: () => true,
}));

vi.mock("@/features/approvals/presentation/components/notification-bell", () => ({
  NotificationBell: () => <div data-testid="bell" />,
}));

vi.mock("@/features/auth/presentation/user-menu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useGetCurrentProject: () => ({ data: undefined }),
    useCreateProject: () => ({ mutate: vi.fn(), isPending: false }),
    useLoadProject: () => ({ mutate: vi.fn(), isPending: false }),
    useListAvailableProjects: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
    useListArchitectures: () => ({ data: [] }),
    useCreateProjectAccessRequest: () => ({ mutate: vi.fn(), isPending: false }),
    listAvailableForkProjects: (...a: unknown[]) => listAvailableForkProjectsMock(...a),
    listMyApprovals: (...a: unknown[]) => listMyApprovalsMock(...a),
    requestFork: vi.fn(),
    submitForkForApproval: vi.fn(),
    getGetCurrentProjectQueryKey: () => ["get-current-project"],
  };
});

import { Home } from "../home";

function setRole(role: AuthUserRole) {
  useAuthMock.mockReturnValue({
    user: { id: "u", username: "u", role, effectiveRole: role, profileComplete: true },
    loading: false,
    logout: vi.fn(),
  });
}

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Home />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  useAuthMock.mockReset();
  listAvailableForkProjectsMock.mockReset();
  listMyApprovalsMock.mockReset();
});

describe("<Home /> admin view", () => {
  it("renders the Projects heading and the empty state when no projects exist", async () => {
    setRole("admin");
    renderHome();
    await waitFor(() =>
      expect(screen.getByTestId("text-no-projects")).toBeDefined(),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: /^Projects$/ }),
    ).toBeDefined();
  });

  it("admin sees the 'Add Project' button in the empty state", async () => {
    setRole("admin");
    renderHome();
    await waitFor(() =>
      expect(screen.getByTestId("button-add-project-empty")).toBeDefined(),
    );
  });
});

describe("<Home /> limited view", () => {
  it("limited users see the limited Projects view (no admin 'New Project' button)", async () => {
    setRole("limited");
    listAvailableForkProjectsMock.mockResolvedValue([]);
    listMyApprovalsMock.mockResolvedValue([]);
    renderHome();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: /^Projects$/ }),
      ).toBeDefined(),
    );
    expect(screen.queryByTestId("button-new-project")).toBeNull();
    expect(screen.queryByTestId("text-no-projects")).toBeNull();
  });
});

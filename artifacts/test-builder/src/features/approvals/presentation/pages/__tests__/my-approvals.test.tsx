import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthUserRole } from "@workspace/api-client-react";

const navigateMock = vi.fn();
const useAuthMock = vi.fn();
const listMyApprovalsMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/my-approvals", navigateMock],
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
    listMyApprovals: (...a: unknown[]) => listMyApprovalsMock(...a),
  };
});

import { MyApprovals } from "../my-approvals";

function setRole(role: AuthUserRole) {
  useAuthMock.mockReturnValue({
    user: { id: "u", username: "u", role, effectiveRole: role, profileComplete: true },
    loading: false,
    logout: vi.fn(),
  });
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MyApprovals />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  useAuthMock.mockReset();
  listMyApprovalsMock.mockReset();
});

describe("<MyApprovals />", () => {
  it("redirects admin users to /admin/approval and renders nothing", () => {
    setRole("admin");
    listMyApprovalsMock.mockResolvedValue([]);
    const { container } = renderPage();
    expect(navigateMock).toHaveBeenCalledWith("/admin/approval", {
      replace: true,
    });
    expect(container.textContent).toBe("");
  });

  it("redirects limited_admin users to /admin/approval too", () => {
    setRole("limited_admin");
    listMyApprovalsMock.mockResolvedValue([]);
    renderPage();
    expect(navigateMock).toHaveBeenCalledWith("/admin/approval", {
      replace: true,
    });
  });

  it("renders the empty state for limited users with no submissions", async () => {
    setRole("limited");
    listMyApprovalsMock.mockResolvedValue([]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("my-approvals-empty")).toBeDefined(),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("renders a row for each approval and shows the SDET comment", async () => {
    setRole("limited");
    listMyApprovalsMock.mockResolvedValue([
      {
        id: "a1",
        projectName: "Demo",
        status: "approved",
        submittedAt: "2026-04-28T00:00:00Z",
        decidedAt: "2026-04-28T01:00:00Z",
        comment: "Looks good, merged.",
      },
    ]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("my-approval-row-a1")).toBeDefined(),
    );
    expect(screen.getByTestId("my-approval-status-a1").textContent).toMatch(
      /Approved/i,
    );
    expect(
      screen.getByTestId("my-approval-comment-a1").textContent,
    ).toContain("Looks good, merged.");
  });
});

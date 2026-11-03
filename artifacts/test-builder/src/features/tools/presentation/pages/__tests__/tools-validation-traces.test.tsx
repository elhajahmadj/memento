import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthUserRole } from "@workspace/api-client-react";

const navigateMock = vi.fn();
const useAuthMock = vi.fn();
const useStatsMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/tools/validation-traces", navigateMock],
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
    useGetValidationTraceStats: () => useStatsMock(),
    getGetValidationTraceStatsQueryKey: () => ["k"],
  };
});

import { ToolsValidationTraces } from "../tools-validation-traces";

function setRole(role: AuthUserRole) {
  useAuthMock.mockReturnValue({
    user: { id: "u", username: "u", role, effectiveRole: role, profileComplete: true },
    loading: false,
    logout: vi.fn(),
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToolsValidationTraces />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  useAuthMock.mockReset();
  useStatsMock.mockReset();
});

describe("<ToolsValidationTraces /> role gate", () => {
  it("redirects limited users to '/'", () => {
    setRole("limited");
    useStatsMock.mockReturnValue({ data: undefined, isLoading: true, refetch: vi.fn() });
    renderPage();
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
  });

  it("redirects limited_admin users (admin-only page)", () => {
    setRole("limited_admin");
    useStatsMock.mockReturnValue({ data: undefined, isLoading: true, refetch: vi.fn() });
    renderPage();
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
  });

  it("admin users see the page heading", async () => {
    setRole("admin");
    useStatsMock.mockReturnValue({
      data: { totalBytes: 0, fileCount: 0, lastSweepMs: 0 },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderPage();
    await waitFor(() => expect(navigateMock).not.toHaveBeenCalled());
    expect(screen.getByText(/Validation traces/i)).toBeDefined();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthUserRole } from "@workspace/api-client-react";

const navigateMock = vi.fn();
const useAuthMock = vi.fn();
const internalTestsMock = vi.fn();
const toastError = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/tools", navigateMock],
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
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useListInternalTestSuites: () => internalTestsMock(),
    getListInternalTestSuitesQueryKey: () => ["list-internal-test-suites"],
  };
});

import { Tools } from "../tools";

function setRole(role: AuthUserRole) {
  useAuthMock.mockReturnValue({
    user: { id: "u", username: "u", role, effectiveRole: role, profileComplete: true },
    loading: false,
    logout: vi.fn(),
  });
}

function renderTools() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Tools />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  useAuthMock.mockReset();
  internalTestsMock.mockReset();
  toastError.mockClear();
});

describe("<Tools />", () => {
  it("redirects limited users to '/' and toasts an error", () => {
    setRole("limited");
    internalTestsMock.mockReturnValue({ data: undefined });
    const { container } = renderTools();
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
    expect(toastError).toHaveBeenCalledWith("You don't have access to Tools");
    expect(container.textContent).toBe("");
  });

  it("limited_admin sees Test runs + Activity cards but no admin-only cards", () => {
    setRole("limited_admin");
    internalTestsMock.mockReturnValue({ data: undefined });
    renderTools();
    expect(screen.getByTestId("card-tool-test-runs")).toBeDefined();
    expect(screen.getByTestId("card-tool-activity")).toBeDefined();
    // Cards that moved to /admin must NOT appear in /tools any more.
    expect(screen.queryByTestId("card-tool-approval")).toBeNull();
    expect(screen.queryByTestId("card-tool-fork-requests")).toBeNull();
    expect(screen.queryByTestId("card-tool-project-assignments")).toBeNull();
    // Admin-only cards stay hidden for limited_admin.
    expect(screen.queryByTestId("card-tool-validation-traces")).toBeNull();
    expect(screen.queryByTestId("card-tool-internal-tests")).toBeNull();
    expect(screen.queryByTestId("card-tool-ai-agent")).toBeNull();
    expect(screen.queryByTestId("card-tool-maintenance")).toBeNull();
  });

  it("admin sees the always-on cards (test-runs, validation-traces, ai-agent, activity, maintenance) but not the admin-nav cards", () => {
    setRole("admin");
    internalTestsMock.mockReturnValue({ data: { enabled: false } });
    renderTools();
    expect(screen.getByTestId("card-tool-test-runs")).toBeDefined();
    expect(screen.getByTestId("card-tool-validation-traces")).toBeDefined();
    expect(screen.getByTestId("card-tool-ai-agent")).toBeDefined();
    expect(screen.getByTestId("card-tool-activity")).toBeDefined();
    expect(screen.getByTestId("card-tool-maintenance")).toBeDefined();
    // The admin-nav sections must no longer appear as Tools cards.
    expect(screen.queryByTestId("card-tool-approval")).toBeNull();
    expect(screen.queryByTestId("card-tool-fork-requests")).toBeNull();
    expect(screen.queryByTestId("card-tool-project-assignments")).toBeNull();
  });

  it("admin sees the internal-tests card only when the capability is enabled", () => {
    setRole("admin");
    internalTestsMock.mockReturnValue({ data: { enabled: true } });
    renderTools();
    expect(screen.getByTestId("card-tool-internal-tests")).toBeDefined();
  });

  it("admin does NOT see the internal-tests card when capability is disabled", () => {
    setRole("admin");
    internalTestsMock.mockReturnValue({ data: { enabled: false } });
    renderTools();
    expect(screen.queryByTestId("card-tool-internal-tests")).toBeNull();
  });
});

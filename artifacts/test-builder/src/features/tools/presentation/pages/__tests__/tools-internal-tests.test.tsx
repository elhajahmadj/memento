import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ReactNode } from "react";
import {
  cleanup,
  render,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { AuthUserRole } from "@workspace/api-client-react";

const navigateMock = vi.fn();
const useAuthMock = vi.fn();
const toastError = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/tools/internal-tests", navigateMock],
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
    useListInternalTestSuites: () => ({
      data: { enabled: true, suites: [] },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    }),
    useStartInternalTestRun: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useGetInternalTestRun: () => ({ data: undefined, isLoading: false }),
    getListInternalTestSuitesQueryKey: () => ["k1"],
    getGetInternalTestRunQueryKey: () => ["k2"],
  };
});

import { ToolsInternalTests } from "../tools-internal-tests";

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
      <ToolsInternalTests />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  useAuthMock.mockReset();
  toastError.mockClear();
});

describe("<ToolsInternalTests /> role gate", () => {
  it("redirects non-admin (limited) users to '/'", () => {
    setRole("limited");
    const { container } = renderPage();
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
    expect(container.textContent).toBe("");
  });

  it("redirects limited_admin users (admin-only page)", () => {
    setRole("limited_admin");
    renderPage();
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
  });

  it("admin users see the page", async () => {
    setRole("admin");
    renderPage();
    await waitFor(() => expect(navigateMock).not.toHaveBeenCalled());
  });
});

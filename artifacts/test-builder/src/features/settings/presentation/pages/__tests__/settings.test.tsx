import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthUserRole } from "@workspace/api-client-react";

const navigateMock = vi.fn();
const useAuthMock = vi.fn();
const toastError = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", navigateMock],
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
  Toaster: () => null,
}));

import { Settings } from "../settings";

function setRole(role: AuthUserRole) {
  useAuthMock.mockReturnValue({
    user: { id: "u", username: "u", role, effectiveRole: role, profileComplete: true },
    loading: false,
    logout: vi.fn(),
  });
}

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Settings />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  useAuthMock.mockReset();
  toastError.mockClear();
});

describe("<Settings /> after Settings/Admin/Tools re-org", () => {
  it("plain users (limited) reach Settings and see the Appearance panel — no role gate, no redirect", () => {
    setRole("limited");
    renderSettings();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.getByTestId("settings-section-appearance")).toBeDefined();
    // Admin-only panels that moved to /admin must NOT render on /settings any more.
    expect(screen.queryByTestId("settings-section-architectures")).toBeNull();
    expect(screen.queryByTestId("settings-section-recording")).toBeNull();
    expect(screen.queryByTestId("settings-section-validation")).toBeNull();
    // Tools-page panels must NOT render here either.
    expect(screen.queryByTestId("settings-section-activity")).toBeNull();
    expect(screen.queryByTestId("settings-section-maintenance")).toBeNull();
    // Mocks is anyAdmin so it's hidden from plain users.
    expect(screen.queryByTestId("settings-section-mocks")).toBeNull();
  });

  it("limited_admin sees Appearance + Network mocks but none of the moved panels", () => {
    setRole("limited_admin");
    renderSettings();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("settings-section-appearance")).toBeDefined();
    expect(screen.getByTestId("settings-section-mocks")).toBeDefined();
    expect(screen.queryByTestId("settings-section-architectures")).toBeNull();
    expect(screen.queryByTestId("settings-section-recording")).toBeNull();
    expect(screen.queryByTestId("settings-section-validation")).toBeNull();
    expect(screen.queryByTestId("settings-section-activity")).toBeNull();
    expect(screen.queryByTestId("settings-section-maintenance")).toBeNull();
  });

  it("admin sees Appearance + Mocks + SharedSteps and none of the moved panels", () => {
    setRole("admin");
    renderSettings();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("settings-section-appearance")).toBeDefined();
    expect(screen.getByTestId("settings-section-mocks")).toBeDefined();
    expect(screen.queryByTestId("settings-section-architectures")).toBeNull();
    expect(screen.queryByTestId("settings-section-recording")).toBeNull();
    expect(screen.queryByTestId("settings-section-validation")).toBeNull();
    expect(screen.queryByTestId("settings-section-activity")).toBeNull();
    expect(screen.queryByTestId("settings-section-maintenance")).toBeNull();
  });
});

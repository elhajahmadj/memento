import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const navigateMock = vi.fn();
const updateProfileMock = vi.fn();
const useAuthMock = vi.fn();
const mutateAsyncMock = vi.fn();
let mutationPending = false;

vi.mock("wouter", () => ({
  useLocation: () => ["/profile", navigateMock],
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

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
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

vi.mock("@/shared/hooks/use-nav-layout", () => ({
  useNavLayout: () => ({ layout: "top", setLayout: vi.fn() }),
  NavLayoutProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/features/auth/presentation/user-menu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

vi.mock("@/shared/ui/shell/top-nav", () => ({
  TopNav: () => <div data-testid="top-nav" />,
}));

vi.mock("@/shared/ui/shell/side-nav", () => ({
  SideNavLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/shared/ui/shell/footer", () => ({
  Footer: () => <div data-testid="footer" />,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@workspace/api-client-react", async () => {
  const actual =
    await vi.importActual<typeof import("@workspace/api-client-react")>(
      "@workspace/api-client-react",
    );
  return {
    ...actual,
    useRequestPasswordReset: () => ({
      mutateAsync: mutateAsyncMock,
      isPending: mutationPending,
    }),
  };
});

import { Profile } from "../profile";
import { ApiError } from "@workspace/api-client-react";

function setUser(opts: { isSso: boolean; email?: string | null }) {
  useAuthMock.mockReturnValue({
    user: {
      id: "u",
      username: "u",
      role: "admin",
      profileComplete: true,
      firstName: "Alice",
      lastName: "Anderson",
      title: "QA",
      email: opts.email === undefined ? "alice@example.com" : opts.email,
      authSource: opts.isSso ? "oidc" : "local",
    },
    loading: false,
    updateProfile: updateProfileMock,
    logout: vi.fn(),
    organizations: [],
    activeOrganizationId: null,
  });
}

function makeApiError(status: number, data: unknown = null): ApiError {
  const response = new Response(null, { status });
  return new ApiError(response, data, { method: "POST", url: "/x" });
}

async function switchToPasswordTab() {
  const trigger = screen.getByTestId("tab-profile-password");
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    fireEvent.mouseDown(trigger, { button: 0 });
    fireEvent.click(trigger);
  });
}

beforeEach(() => {
  mutationPending = false;
});

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  updateProfileMock.mockReset();
  useAuthMock.mockReset();
  mutateAsyncMock.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
  vi.useRealTimers();
});

describe("<Profile />", () => {
  it("renders both tabs with User info selected by default", () => {
    setUser({ isSso: false });
    render(<Profile />);
    expect(screen.getByTestId("tab-profile-user-info")).toBeTruthy();
    expect(screen.getByTestId("tab-profile-password")).toBeTruthy();
    expect(screen.getByTestId("input-first-name")).toBeTruthy();
  });

  it("renders the email as read-only with the Update-at-IdP link for SSO users", () => {
    setUser({ isSso: true });
    render(<Profile />);
    const email = screen.getByTestId("input-email") as HTMLInputElement;
    expect(email.readOnly).toBe(true);
    const link = screen.getByTestId("link-update-on-nexus") as HTMLAnchorElement;
    expect(link.href).toContain("your-idp.example.com/profile");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(link.rel).toContain("noreferrer");
  });

  it("keeps the email editable and hides the IdP link for local users", () => {
    setUser({ isSso: false });
    render(<Profile />);
    const email = screen.getByTestId("input-email") as HTMLInputElement;
    expect(email.readOnly).toBe(false);
    expect(screen.queryByTestId("link-update-on-nexus")).toBeNull();
  });

  it("only enables Save once something actually changes", () => {
    setUser({ isSso: false });
    render(<Profile />);
    const save = screen.getByTestId("button-save-profile") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-title"), {
      target: { value: "Lead QA" },
    });
    expect(save.disabled).toBe(false);
  });

  it("shows confirm modal then sends reset, toasts success and starts a 60s cooldown", async () => {
    setUser({ isSso: true });
    mutateAsyncMock.mockResolvedValue({});
    render(<Profile />);
    await switchToPasswordTab();
    fireEvent.click(screen.getByTestId("button-reset-password"));
    expect(screen.getByTestId("dialog-confirm-reset-password")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-confirm-reset-password"));
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const btn = screen.getByTestId(
      "button-reset-password",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/60s/);
  });

  it("toasts a throttled message on 429 and respects the server retry-after", async () => {
    setUser({ isSso: true });
    mutateAsyncMock.mockRejectedValue(
      makeApiError(429, { error: "slow", retryAfterSeconds: 30 }),
    );
    render(<Profile />);
    await switchToPasswordTab();
    fireEvent.click(screen.getByTestId("button-reset-password"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-confirm-reset-password"));
    });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const btn = screen.getByTestId(
      "button-reset-password",
    ) as HTMLButtonElement;
    expect(btn.textContent).toMatch(/30s/);
  });

  it("toasts an upstream-failure message on 502/5xx/network", async () => {
    setUser({ isSso: true });
    mutateAsyncMock.mockRejectedValue(makeApiError(502, { error: "boom" }));
    render(<Profile />);
    await switchToPasswordTab();
    fireEvent.click(screen.getByTestId("button-reset-password"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-confirm-reset-password"));
    });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(
      String(toastError.mock.calls[0]?.[0] ?? ""),
    ).toMatch(/identity provider/i);
  });

  it("shows the inline notice on 503 (IdP not configured) instead of a toast", async () => {
    setUser({ isSso: true });
    mutateAsyncMock.mockRejectedValue(
      makeApiError(503, { error: "Not configured" }),
    );
    render(<Profile />);
    await switchToPasswordTab();
    fireEvent.click(screen.getByTestId("button-reset-password"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-confirm-reset-password"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("notice-reset-not-configured")).toBeTruthy(),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("disables the Reset password button for local username/password users", async () => {
    setUser({ isSso: false });
    render(<Profile />);
    await switchToPasswordTab();
    const btn = screen.getByTestId(
      "button-reset-password",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId("text-reset-local-user-note")).toBeTruthy();
  });
});

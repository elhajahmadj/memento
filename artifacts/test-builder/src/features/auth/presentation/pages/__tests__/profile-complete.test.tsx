import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
const updateProfileMock = vi.fn();
const useAuthMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/profile/complete", navigateMock],
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

import { ProfileComplete } from "../profile-complete";

function setUser(profileComplete: boolean) {
  useAuthMock.mockReturnValue({
    user: {
      id: "u",
      username: "u",
      role: "admin",
      profileComplete,
      firstName: profileComplete ? "Alice" : "",
      lastName: profileComplete ? "Anderson" : "",
      title: profileComplete ? "QA" : "",
      email: profileComplete ? "alice@x.com" : "",
    },
    loading: false,
    updateProfile: updateProfileMock,
    logout: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  updateProfileMock.mockReset();
  useAuthMock.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("<ProfileComplete />", () => {
  it("disables Save until every field is filled and the email is valid", () => {
    setUser(false);
    render(<ProfileComplete />);
    const save = screen.getByTestId("button-save-profile") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("input-first-name"), { target: { value: "A" } });
    fireEvent.change(screen.getByTestId("input-last-name"), { target: { value: "B" } });
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "QA" } });
    fireEvent.change(screen.getByTestId("input-email"), { target: { value: "not-an-email" } });
    expect(screen.getByTestId("text-email-invalid")).toBeDefined();
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("input-email"), { target: { value: "a@b.co" } });
    expect(save.disabled).toBe(false);
  });

  it("submits trimmed values, shows a success toast, and navigates home for new users", async () => {
    setUser(false);
    updateProfileMock.mockResolvedValueOnce({});
    render(<ProfileComplete />);
    fireEvent.change(screen.getByTestId("input-first-name"), { target: { value: " Alice " } });
    fireEvent.change(screen.getByTestId("input-last-name"), { target: { value: " Anderson " } });
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "QA" } });
    fireEvent.change(screen.getByTestId("input-email"), { target: { value: " a@b.co " } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-save-profile"));
    });

    expect(updateProfileMock).toHaveBeenCalledWith({
      firstName: "Alice",
      lastName: "Anderson",
      title: "QA",
      email: "a@b.co",
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Profile saved"),
    );
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
  });

  it("for already-complete profiles, shows 'Profile updated' and stays on the page", async () => {
    setUser(true);
    updateProfileMock.mockResolvedValueOnce({});
    render(<ProfileComplete />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-save-profile"));
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Profile updated"),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("surfaces an inline error when updateProfile rejects", async () => {
    setUser(false);
    updateProfileMock.mockRejectedValueOnce(new Error("save failed"));
    render(<ProfileComplete />);
    fireEvent.change(screen.getByTestId("input-first-name"), { target: { value: "A" } });
    fireEvent.change(screen.getByTestId("input-last-name"), { target: { value: "B" } });
    fireEvent.change(screen.getByTestId("input-title"), { target: { value: "T" } });
    fireEvent.change(screen.getByTestId("input-email"), { target: { value: "a@b.co" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-save-profile"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("text-profile-error").textContent).toBe(
        "save failed",
      ),
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({
  useLocation: () => ["/about", vi.fn()],
  Link: ({ children, href, ...rest }: { children: ReactNode; href?: string } & Record<string, unknown>) =>
    <a href={href} {...rest}>{children}</a>,
}));

vi.mock("@/shared/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "dark", isDark: true, setTheme: vi.fn(), toggleTheme: vi.fn() }),
  useIsDarkTheme: () => true,
}));

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => ({
    user: { id: "u", username: "u", role: "admin", profileComplete: true },
    loading: false,
    logout: vi.fn(),
  }),
}));

vi.mock("@/features/approvals/presentation/components/notification-bell", () => ({
  NotificationBell: () => <div data-testid="bell" />,
}));

vi.mock("@/features/auth/presentation/user-menu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

import { About } from "../about";

afterEach(() => cleanup());

describe("<About />", () => {
  it("renders the about title, summary copy and creator card", () => {
    render(<About />);
    expect(screen.getByTestId("text-about-title").textContent).toBe("About");
    expect(screen.getByTestId("card-about-creator")).toBeDefined();
    expect(screen.getByTestId("text-about-creator-name").textContent).toContain(
      "Ahmad Elhaj",
    );
    expect(screen.getByTestId("text-about-creator-title").textContent).toBe("SDET");
    const link = screen.getByTestId("link-about-creator-email") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("mailto:ElhajAhmadJ@gmail.com");
  });

  it("includes a back-to-home button via the page shell", () => {
    render(<About />);
    expect(screen.getByTestId("button-about-back")).toBeDefined();
  });
});

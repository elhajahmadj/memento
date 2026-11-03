/**
 * Specs for the shared `useSwitchOrgGate` / `SwitchOrgGatePage` helper
 * that role-gated pages use to decide between "redirect with toast"
 * and "inline switch-org prompt". The hook and the page wrapper are
 * the deduped, single-source-of-truth implementation behind every
 * `/admin` and `/tools/*` role gate.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const navigateMock = vi.fn();
const useOrgsMatchingRoleMock = vi.fn();
const toastError = vi.fn();
const useAuthMock = vi.fn();
const useNavLayoutMock = vi.fn(() => ({ layout: "side" as const }));

vi.mock("wouter", () => ({
  useLocation: () => ["/x", navigateMock],
  Link: ({ children, href, ...rest }: { children: ReactNode; href?: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() },
}));

vi.mock("@/features/auth/presentation/role", () => ({
  useOrgsMatchingRole: (...a: unknown[]) => useOrgsMatchingRoleMock(...a),
  ROLE_PREDICATES: {
    admin: () => false,
    anyAdmin: () => false,
    limitedAdmin: () => false,
  },
}));

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/shared/hooks/use-nav-layout", () => ({
  useNavLayout: () => useNavLayoutMock(),
}));

vi.mock("@/shared/ui/shell/top-nav", () => ({ TopNav: () => <div /> }));
vi.mock("@/shared/ui/shell/side-nav", () => ({
  SideNavLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/shared/ui/shell/footer", () => ({ Footer: () => <div /> }));

import {
  SwitchOrgGatePage,
  useSwitchOrgGate,
} from "../switch-org-gate";

function Harness(props: Parameters<typeof useSwitchOrgGate>[0]) {
  const { canPromptSwitch } = useSwitchOrgGate(props);
  return <div data-testid="harness">{canPromptSwitch ? "prompt" : "no-prompt"}</div>;
}

function renderHook(props: Parameters<typeof useSwitchOrgGate>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthMock.mockReturnValue({
    user: { id: "u", username: "u", role: "limited", profileComplete: true },
    loading: false,
    setActiveOrganization: vi.fn(),
    refresh: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  useOrgsMatchingRoleMock.mockReset();
  toastError.mockReset();
  useAuthMock.mockReset();
});

describe("useSwitchOrgGate", () => {
  it("does nothing when allowed", () => {
    useOrgsMatchingRoleMock.mockReturnValue([]);
    renderHook({ allowed: true, requires: "admin", pageLabel: "Tools" });
    expect(navigateMock).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.getByTestId("harness").textContent).toBe("no-prompt");
  });

  it("redirects with default toast when denied and no other org qualifies", () => {
    useOrgsMatchingRoleMock.mockReturnValue([]);
    renderHook({ allowed: false, requires: "admin", pageLabel: "Tools" });
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
    expect(toastError).toHaveBeenCalledWith("You don't have access to Tools");
    expect(screen.getByTestId("harness").textContent).toBe("no-prompt");
  });

  it("honors a custom toast message and redirectTo", () => {
    useOrgsMatchingRoleMock.mockReturnValue([]);
    renderHook({
      allowed: false,
      requires: "admin",
      pageLabel: "Tools",
      toastMessage: "Nope",
      redirectTo: "/home",
    });
    expect(toastError).toHaveBeenCalledWith("Nope");
    expect(navigateMock).toHaveBeenCalledWith("/home", { replace: true });
  });

  it("skips the redirect and returns canPromptSwitch when another org grants the role", () => {
    useOrgsMatchingRoleMock.mockReturnValue([
      { id: "o1", externalKey: "orgA", displayName: "Org A", role: "admin" },
    ]);
    renderHook({ allowed: false, requires: "admin", pageLabel: "Tools" });
    expect(navigateMock).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.getByTestId("harness").textContent).toBe("prompt");
  });
});

describe("<SwitchOrgGatePage />", () => {
  it("renders the heading, description, and a switch prompt with the given testId", () => {
    useOrgsMatchingRoleMock.mockReturnValue([
      { id: "o1", externalKey: "orgA", displayName: "Org A", role: "admin" },
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SwitchOrgGatePage
          pageLabel="Tools"
          description="An admin area."
          requires="anyAdmin"
          testId="tools-switch-org-prompt"
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Tools")).toBeDefined();
    expect(screen.getByText("An admin area.")).toBeDefined();
    expect(screen.getByTestId("tools-switch-org-prompt")).toBeDefined();
    expect(screen.getByTestId("tools-switch-org-prompt-button-orgA")).toBeDefined();
  });
});

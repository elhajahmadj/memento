import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import {
  AdminOnly,
  AnyAdminOnly,
  RequireRole,
  useIsAdmin,
  useIsAnyAdmin,
  useIsLimitedAdmin,
  useRole,
} from "../role";
import type { AuthUserRole } from "@workspace/api-client-react";

const useAuthMock = vi.fn();

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

function setRole(role: AuthUserRole | null) {
  useAuthMock.mockReturnValue({
    user:
      role === null
        ? null
        : {
            // `useRole` reads from `effectiveRole` (the resolved per-
            // org role) rather than the raw `users.role` column. Set
            // both so tests double as a regression for "never silently
            // fall back to user.role".
            role,
            effectiveRole: role,
            id: "u1",
            username: "u",
          },
    loading: false,
  });
}

function HookProbe({ render: r }: { render: () => string }) {
  return <div data-testid="probe">{r()}</div>;
}

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
});

describe("role hooks", () => {
  it("useRole reflects the current user's role and is null when signed out", () => {
    setRole(null);
    const { rerender } = render(
      <HookProbe render={() => String(useRole())} />,
    );
    expect(screen.getByTestId("probe").textContent).toBe("null");

    setRole("admin");
    rerender(<HookProbe render={() => String(useRole())} />);
    expect(screen.getByTestId("probe").textContent).toBe("admin");
  });

  it("useIsAdmin only matches the strict admin role", () => {
    for (const [role, expected] of [
      ["admin", "true"],
      ["limited_admin", "false"],
      ["limited", "false"],
      [null, "false"],
    ] as const) {
      cleanup();
      setRole(role);
      render(<HookProbe render={() => String(useIsAdmin())} />);
      expect(screen.getByTestId("probe").textContent).toBe(expected);
    }
  });

  it("useIsLimitedAdmin only matches limited_admin", () => {
    for (const [role, expected] of [
      ["admin", "false"],
      ["limited_admin", "true"],
      ["limited", "false"],
    ] as const) {
      cleanup();
      setRole(role);
      render(<HookProbe render={() => String(useIsLimitedAdmin())} />);
      expect(screen.getByTestId("probe").textContent).toBe(expected);
    }
  });

  it("useIsAnyAdmin matches both admin and limited_admin", () => {
    for (const [role, expected] of [
      ["admin", "true"],
      ["limited_admin", "true"],
      ["limited", "false"],
      [null, "false"],
    ] as const) {
      cleanup();
      setRole(role);
      render(<HookProbe render={() => String(useIsAnyAdmin())} />);
      expect(screen.getByTestId("probe").textContent).toBe(expected);
    }
  });
});

describe("role guard components", () => {
  it("RequireRole renders children only when the role matches", () => {
    setRole("limited");
    const { rerender } = render(
      <RequireRole role="admin" fallback={<span data-testid="fallback" />}>
        <span data-testid="child" />
      </RequireRole>,
    );
    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getByTestId("fallback")).toBeDefined();

    setRole("admin");
    rerender(
      <RequireRole role="admin" fallback={<span data-testid="fallback" />}>
        <span data-testid="child" />
      </RequireRole>,
    );
    expect(screen.getByTestId("child")).toBeDefined();
  });

  it("AdminOnly hides children for non-admin roles", () => {
    setRole("limited_admin");
    const { rerender } = render(
      <AdminOnly fallback={<span data-testid="hidden" />}>
        <span data-testid="admin-only" />
      </AdminOnly>,
    );
    expect(screen.queryByTestId("admin-only")).toBeNull();
    expect(screen.getByTestId("hidden")).toBeDefined();

    setRole("admin");
    rerender(
      <AdminOnly fallback={<span data-testid="hidden" />}>
        <span data-testid="admin-only" />
      </AdminOnly>,
    );
    expect(screen.getByTestId("admin-only")).toBeDefined();
  });

  it("AdminOnly flips when the active org changes (org-switch UI gating)", () => {
    // End-to-end gating contract for the per-org roles task: when an
    // SSO user is Admin in OrgA but Limited Admin in OrgB, switching
    // the active org in the user-menu causes /auth/me to return a
    // new `effectiveRole`, which is what `AdminOnly` reads. Re-
    // rendering with the flipped role must hide admin-only UI even
    // though `user.role` (the SSO baseline `limited`) never changed.
    // This is the same flip exercised on the server by the "Admin in
    // OrgA / Limited Admin in OrgB: requireAdmin flips" test in
    // orgScoping.routes.test.ts.
    setRole("admin"); // OrgA active.
    const { rerender } = render(
      <AdminOnly fallback={<span data-testid="locked" />}>
        <span data-testid="admin-tool" />
      </AdminOnly>,
    );
    expect(screen.getByTestId("admin-tool")).toBeDefined();
    expect(screen.queryByTestId("locked")).toBeNull();

    setRole("limited_admin"); // OrgB now active — UI must lock down.
    rerender(
      <AdminOnly fallback={<span data-testid="locked" />}>
        <span data-testid="admin-tool" />
      </AdminOnly>,
    );
    expect(screen.queryByTestId("admin-tool")).toBeNull();
    expect(screen.getByTestId("locked")).toBeDefined();
  });

  it("AnyAdminOnly accepts both admin and limited_admin", () => {
    setRole("limited");
    const { rerender } = render(
      <AnyAdminOnly fallback={<span data-testid="locked" />}>
        <span data-testid="any-admin" />
      </AnyAdminOnly>,
    );
    expect(screen.getByTestId("locked")).toBeDefined();

    setRole("limited_admin");
    rerender(
      <AnyAdminOnly fallback={<span data-testid="locked" />}>
        <span data-testid="any-admin" />
      </AnyAdminOnly>,
    );
    expect(screen.getByTestId("any-admin")).toBeDefined();

    setRole("admin");
    rerender(
      <AnyAdminOnly fallback={<span data-testid="locked" />}>
        <span data-testid="any-admin" />
      </AnyAdminOnly>,
    );
    expect(screen.getByTestId("any-admin")).toBeDefined();
  });
});

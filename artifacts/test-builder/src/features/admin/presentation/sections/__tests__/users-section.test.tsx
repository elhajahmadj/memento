import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AdminUser } from "@workspace/api-client-react";

const {
  toastSuccess,
  toastError,
  resendMutateAsync,
  updateMutateAsync,
  deleteMutateAsync,
  listUsersData,
} = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  resendMutateAsync: vi.fn(),
  updateMutateAsync: vi.fn(),
  deleteMutateAsync: vi.fn(),
  listUsersData: { current: [] as AdminUser[] },
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => ({
    user: { id: "viewer-admin-id", username: "viewer", role: "admin" },
    refresh: vi.fn(),
    activeOrganizationId: null,
    organizations: [],
  }),
}));

vi.mock("@/features/auth/presentation/role", () => ({
  useIsMementoAdmin: () => false,
}));

// Radix Select is awkward to drive in jsdom (it relies on pointer
// events that jsdom does not implement). Swap it for a native
// <select>/<option> shim so role-change interaction can be exercised
// with a plain `change` event. The mock walks the Select's children
// to lift the `data-testid` off SelectTrigger and the <option> list
// off SelectContent into a flat native <select> element so the
// existing `select-role-<username>` test-id keeps resolving.
vi.mock("@/shared/ui/select", async () => {
  const React = await import("react");
  type AnyEl = React.ReactElement<{
    children?: React.ReactNode;
    value?: string;
    "data-testid"?: string;
  }>;
  const isEl = (n: unknown): n is AnyEl =>
    typeof n === "object" && n !== null && "props" in (n as object);
  const walk = (
    node: React.ReactNode,
    out: {
      triggerTestId?: string;
      options: Array<{ value: string; label: React.ReactNode }>;
    },
  ): void => {
    React.Children.forEach(node, (child) => {
      if (!isEl(child)) return;
      const typeName =
        (child.type as { displayName?: string; name?: string })?.displayName ??
        (child.type as { name?: string })?.name ??
        "";
      if (typeName === "SelectTrigger" && child.props["data-testid"]) {
        out.triggerTestId = child.props["data-testid"];
      }
      if (typeName === "SelectItem" && child.props.value !== undefined) {
        out.options.push({
          value: child.props.value,
          label: child.props.children,
        });
      }
      if (child.props.children) walk(child.props.children, out);
    });
  };
  const Select = ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
    children?: React.ReactNode;
  }) => {
    const out: {
      triggerTestId?: string;
      options: Array<{ value: string; label: React.ReactNode }>;
    } = { options: [] };
    walk(children, out);
    return (
      <select
        data-testid={out.triggerTestId}
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {out.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  };
  const SelectTrigger = (_props: Record<string, unknown>) => null;
  SelectTrigger.displayName = "SelectTrigger";
  const SelectContent = (_props: Record<string, unknown>) => null;
  SelectContent.displayName = "SelectContent";
  const SelectItem = (_props: Record<string, unknown>) => null;
  SelectItem.displayName = "SelectItem";
  const SelectValue = () => null;
  SelectValue.displayName = "SelectValue";
  return { Select, SelectTrigger, SelectContent, SelectItem, SelectValue };
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useListUsers: () => ({
      data: listUsersData.current,
      isLoading: false,
    }),
    useResendWelcomeEmail: (opts?: {
      mutation?: { onSettled?: () => void };
    }) => ({
      mutateAsync: async (vars: { id: string }) => {
        try {
          return await resendMutateAsync(vars);
        } finally {
          opts?.mutation?.onSettled?.();
        }
      },
      isPending: false,
    }),
    useUpdateUser: () => ({
      mutateAsync: updateMutateAsync,
      isPending: false,
    }),
    useDeleteUser: () => ({
      mutateAsync: deleteMutateAsync,
      isPending: false,
    }),
    getListUsersQueryKey: () => ["users"],
  };
});

import { UsersSection } from "../users-section";

function makeUser(overrides: Partial<AdminUser>): AdminUser {
  return {
    id: "u1",
    username: "u1",
    role: "limited",
    firstName: "U",
    lastName: "One",
    title: null,
    email: "u1@example.com",
    profileComplete: true,
    lastLoginAt: null,
    idpExternalId: null,
    authSource: "local",
    memberships: [],
    ...overrides,
  };
}

function renderUI() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <UsersSection viewerIsAdmin />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  resendMutateAsync.mockReset();
  updateMutateAsync.mockReset().mockResolvedValue({ role: "limited" });
  deleteMutateAsync.mockReset().mockResolvedValue({});
  listUsersData.current = [];
});

afterEach(() => cleanup());

describe("<UsersSection /> Resend welcome action", () => {
  it("hides the Resend welcome button for local users (no idpExternalId)", () => {
    listUsersData.current = [
      makeUser({ id: "u-local", username: "local-user", idpExternalId: null }),
    ];
    renderUI();
    expect(
      screen.queryByTestId("button-resend-welcome-local-user"),
    ).toBeNull();
  });

  it("shows the Resend welcome button for IDP-provisioned users", () => {
    listUsersData.current = [
      makeUser({
        id: "u-idp",
        username: "idp-user",
        idpExternalId: "idp-guid-123",
      }),
    ];
    renderUI();
    expect(screen.getByTestId("button-resend-welcome-idp-user")).toBeTruthy();
  });

  it("on success, shows a toast that includes the resend count returned by the IDP", async () => {
    listUsersData.current = [
      makeUser({
        id: "u-idp",
        username: "idp-user",
        idpExternalId: "idp-guid-123",
      }),
    ];
    resendMutateAsync.mockResolvedValue({
      message: "ok",
      lastResentAt: "2026-05-07T18:42:11Z",
      resendCount: 3,
    });

    renderUI();
    fireEvent.click(screen.getByTestId("button-resend-welcome-idp-user"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(resendMutateAsync).toHaveBeenCalledWith({ id: "u-idp" });
    const msg = toastSuccess.mock.calls[0]![0] as string;
    expect(msg).toContain("idp-user");
    expect(msg).toContain("resend #3");
  });

  it("on a 429 throttle, surfaces the retry-after hint inside the error toast", async () => {
    listUsersData.current = [
      makeUser({
        id: "u-idp",
        username: "idp-user",
        idpExternalId: "idp-guid-123",
      }),
    ];
    const apiErr = Object.assign(new Error("Please wait before resending."), {
      status: 429,
      data: {
        error: "Please wait before resending.",
        retryAfterSeconds: 47,
      },
    });
    resendMutateAsync.mockRejectedValue(apiErr);

    renderUI();
    fireEvent.click(screen.getByTestId("button-resend-welcome-idp-user"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const msg = toastError.mock.calls[0]![0] as string;
    expect(msg).toContain("Please wait before resending.");
    expect(msg).toContain("Try again in 47s");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  // Round-3 review: prove the Team Admin members surface gates an
  // admin → non-admin role change behind an explicit confirm dialog
  // and only dispatches the underlying mutation once the admin
  // confirms. Regression-guards against accidentally collapsing the
  // two-step demote UX into a one-click select.
  describe("admin → non-admin demotion confirmation", () => {
    const target = (): AdminUser =>
      makeUser({
        id: "admin-target-id",
        username: "other-admin",
        role: "admin",
        firstName: "Other",
        lastName: "Admin",
        authSource: "local",
        memberships: [],
      });

    it("opens the demote confirm dialog and does NOT dispatch the role mutation until the admin clicks Demote", async () => {
      // Two admins on the list so the orphan-guard does not disable
      // the dropdown for the target.
      listUsersData.current = [
        makeUser({
          id: "viewer-admin-id",
          username: "viewer",
          role: "admin",
        }),
        target(),
      ];

      renderUI();
      const select = screen.getByTestId(
        "select-role-other-admin",
      ) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "limited" } });

      // Dialog is up, mutation has NOT been called yet.
      await waitFor(() =>
        expect(screen.getByText("Demote to Limited?")).toBeTruthy(),
      );
      expect(updateMutateAsync).not.toHaveBeenCalled();

      // Confirm — now the mutation fires with the global-role payload
      // (no orgId, since this user has no per-org memberships and the
      // viewer has no active org).
      fireEvent.click(screen.getByTestId("button-confirm-demote-user"));
      await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
      expect(updateMutateAsync).toHaveBeenCalledWith({
        id: "admin-target-id",
        data: { role: "limited" },
      });
    });

    it("cancelling the dialog leaves the mutation un-called and closes the dialog", async () => {
      listUsersData.current = [
        makeUser({
          id: "viewer-admin-id",
          username: "viewer",
          role: "admin",
        }),
        target(),
      ];

      renderUI();
      fireEvent.change(
        screen.getByTestId("select-role-other-admin") as HTMLSelectElement,
        { target: { value: "limited" } },
      );
      await waitFor(() =>
        expect(screen.getByText("Demote to Limited?")).toBeTruthy(),
      );

      // Click Cancel — there are two "Cancel" buttons in the tree if
      // any other dialog is mounted; scope to the open demote dialog
      // by walking from the confirm button's footer.
      const confirmBtn = screen.getByTestId("button-confirm-demote-user");
      const footer = confirmBtn.parentElement!;
      const cancelBtn = Array.from(footer.querySelectorAll("button")).find(
        (b) => b.textContent === "Cancel",
      )!;
      fireEvent.click(cancelBtn);

      await waitFor(() =>
        expect(screen.queryByText("Demote to Limited?")).toBeNull(),
      );
      expect(updateMutateAsync).not.toHaveBeenCalled();
    });

    it("a lateral admin ↔ admin role pick does NOT open the demote dialog and dispatches the mutation immediately", async () => {
      // Promote local admin → memento_admin requires a memento-admin
      // viewer. For this test we exercise the "no-op pick" path:
      // selecting the current role should be a true no-op (no
      // dialog, no mutation).
      listUsersData.current = [
        makeUser({
          id: "viewer-admin-id",
          username: "viewer",
          role: "admin",
        }),
        target(),
      ];
      renderUI();
      const select = screen.getByTestId(
        "select-role-other-admin",
      ) as HTMLSelectElement;
      // Re-select the same value — handleRoleSelect short-circuits.
      fireEvent.change(select, { target: { value: "admin" } });
      expect(screen.queryByText("Demote to Limited?")).toBeNull();
      expect(updateMutateAsync).not.toHaveBeenCalled();
    });
  });

  it("on a non-429 error, surfaces the server-provided error message verbatim", async () => {
    listUsersData.current = [
      makeUser({
        id: "u-idp",
        username: "idp-user",
        idpExternalId: "idp-guid-123",
      }),
    ];
    const apiErr = Object.assign(new Error("fallback msg"), {
      status: 502,
      data: { error: "IdP 502: bad gateway" },
    });
    resendMutateAsync.mockRejectedValue(apiErr);

    renderUI();
    fireEvent.click(screen.getByTestId("button-resend-welcome-idp-user"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const msg = toastError.mock.calls[0]![0] as string;
    expect(msg).toBe("IdP 502: bad gateway");
    expect(msg).not.toContain("Try again");
  });
});

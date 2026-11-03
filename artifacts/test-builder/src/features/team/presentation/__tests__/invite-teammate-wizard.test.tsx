import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const {
  toastSuccess,
  toastError,
  createMutateAsync,
  authValue,
  isMementoAdminValue,
} = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  createMutateAsync: vi.fn(),
  authValue: {
    current: {
      canProvisionInIdp: false,
      idpProvisioningEnabled: true,
    },
  },
  isMementoAdminValue: { current: false },
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
  useAuth: () => authValue.current,
}));

vi.mock("@/features/auth/presentation/role", () => ({
  useIsMementoAdmin: () => isMementoAdminValue.current,
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useCreateTeamInvitation: (opts?: {
      mutation?: {
        onSuccess?: (res: unknown) => void;
        onError?: (err: Error) => void;
      };
    }) => ({
      mutateAsync: async (vars: { data: unknown }) => {
        try {
          const res = await createMutateAsync(vars);
          opts?.mutation?.onSuccess?.(res);
          return res;
        } catch (err) {
          opts?.mutation?.onError?.(err as Error);
          throw err;
        }
      },
      isPending: false,
    }),
    getListTeamInvitationsQueryKey: () => ["team-invitations"],
  };
});

import { InviteTeammateWizard } from "../invite-teammate-wizard";

function renderWizard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <InviteTeammateWizard open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  createMutateAsync.mockReset();
  authValue.current = {
    canProvisionInIdp: false,
    idpProvisioningEnabled: true,
  };
  isMementoAdminValue.current = false;
});

afterEach(() => {
  cleanup();
});

describe("InviteTeammateWizard", () => {
  it("renders step 1 and disables Next until a valid email is entered", () => {
    renderWizard();
    expect(screen.getByTestId("dialog-invite-teammate")).toBeTruthy();
    expect(screen.getByTestId("invite-step-who")).toBeTruthy();

    const next = screen.getByTestId("button-invite-next") as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    const email = screen.getByTestId("input-invite-email") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "not-an-email" } });
    expect(next.disabled).toBe(true);
    expect(
      screen.getByText(/Please enter a valid email address\./),
    ).toBeTruthy();

    fireEvent.change(email, { target: { value: "ada@example.com" } });
    expect(next.disabled).toBe(false);
  });

  it("shows the plain-language role catalog on step 2 without the Owner option for non-memento admins", () => {
    renderWizard();
    fireEvent.change(screen.getByTestId("input-invite-email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByTestId("button-invite-next"));

    expect(screen.getByTestId("invite-step-role")).toBeTruthy();
    expect(screen.getByTestId("option-role-admin")).toBeTruthy();
    expect(screen.getByTestId("option-role-limited_admin")).toBeTruthy();
    expect(screen.getByTestId("option-role-limited")).toBeTruthy();
    // The Owner / memento_admin row is gated behind isMementoAdmin.
    expect(screen.queryByTestId("option-role-memento_admin")).toBeNull();

    // Display names from the role catalog (task #16 plain-language names).
    expect(screen.getByText("Team Admin")).toBeTruthy();
    expect(screen.getByText("Tester")).toBeTruthy();
    expect(screen.getByText("Viewer")).toBeTruthy();
  });

  it("renders plain-language role descriptions (summary + first canDo + first cantDo) so the admin can pick the right role", () => {
    renderWizard();
    fireEvent.change(screen.getByTestId("input-invite-email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByTestId("button-invite-next"));
    // Summary line for the Team Admin (admin) role from role-catalog.
    expect(
      screen.getByText(
        /Runs the team for one organization: invites teammates/i,
      ),
    ).toBeTruthy();
    // Summary line for the Tester (limited_admin) role.
    expect(
      screen.getByText(
        /Builds and runs tests on projects assigned to them/i,
      ),
    ).toBeTruthy();
    // Summary line for the Viewer (limited) role.
    expect(
      screen.getByText(
        /Read-only collaborator\. Can view assigned projects/i,
      ),
    ).toBeTruthy();
  });

  it("requires the admin to land on the review step and click Send before mutating (no implicit role-change apply)", async () => {
    createMutateAsync.mockResolvedValue({
      invitation: { email: "ada@example.com", acceptUrl: null },
    });
    renderWizard();
    fireEvent.change(screen.getByTestId("input-invite-email"), {
      target: { value: "ada@example.com" },
    });
    // Advancing through steps 1->2->3 must NOT call the mutation.
    fireEvent.click(screen.getByTestId("button-invite-next"));
    expect(createMutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-invite-next"));
    expect(createMutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-invite-next"));
    expect(createMutateAsync).not.toHaveBeenCalled();
    // Review step (4) is the confirmation gate; the role/delivery
    // summary lines should be visible *before* the user commits.
    expect(screen.getByTestId("invite-step-review")).toBeTruthy();
    expect(screen.getByText(/Viewer/)).toBeTruthy();
    expect(screen.getByText(/Email link/)).toBeTruthy();
    // Only the explicit Send click commits.
    fireEvent.click(screen.getByTestId("button-invite-send"));
    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledTimes(1);
    });
  });

  it("reveals the Owner option for a memento_admin caller", () => {
    isMementoAdminValue.current = true;
    renderWizard();
    fireEvent.change(screen.getByTestId("input-invite-email"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.click(screen.getByTestId("button-invite-next"));
    expect(screen.getByTestId("option-role-memento_admin")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();
  });

  it("disables the IDP delivery option when the caller cannot provision in the IDP", () => {
    renderWizard();
    fireEvent.change(screen.getByTestId("input-invite-email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByTestId("button-invite-next"));
    fireEvent.click(screen.getByTestId("button-invite-next"));

    expect(screen.getByTestId("invite-step-delivery")).toBeTruthy();
    const idp = screen
      .getByTestId("option-delivery-idp")
      .querySelector("input") as HTMLInputElement;
    expect(idp.disabled).toBe(true);
    expect(
      screen.getByText(
        /Available only to admins signed in via SSO with an active organization picked\./,
      ),
    ).toBeTruthy();
  });

  it("sends the invitation on step 4 and surfaces the accept-url on success", async () => {
    createMutateAsync.mockResolvedValue({
      invitation: {
        email: "ada@example.com",
        acceptUrl: "https://memento.test/accept-invite?token=abc",
      },
    });
    renderWizard();
    fireEvent.change(screen.getByTestId("input-invite-email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByTestId("button-invite-next"));
    fireEvent.click(screen.getByTestId("button-invite-next"));
    fireEvent.click(screen.getByTestId("button-invite-next"));
    expect(screen.getByTestId("invite-step-review")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-invite-send"));

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(createMutateAsync).toHaveBeenCalledWith({
      data: {
        email: "ada@example.com",
        role: "limited",
        deliveryMethod: "email",
      },
    });
    await waitFor(() => {
      expect(
        (
          screen.getByTestId("input-invite-accept-url") as HTMLInputElement
        ).value,
      ).toBe("https://memento.test/accept-invite?token=abc");
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("surfaces a server error via toast.error and does not advance to the success state", async () => {
    createMutateAsync.mockRejectedValue(
      new Error("An active invitation already exists for this email."),
    );
    renderWizard();
    fireEvent.change(screen.getByTestId("input-invite-email"), {
      target: { value: "dup@example.com" },
    });
    fireEvent.click(screen.getByTestId("button-invite-next"));
    fireEvent.click(screen.getByTestId("button-invite-next"));
    fireEvent.click(screen.getByTestId("button-invite-next"));
    fireEvent.click(screen.getByTestId("button-invite-send"));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "An active invitation already exists for this email.",
      );
    });
    // No accept-url surfaced when the create call failed.
    expect(screen.queryByTestId("input-invite-accept-url")).toBeNull();
  });
});

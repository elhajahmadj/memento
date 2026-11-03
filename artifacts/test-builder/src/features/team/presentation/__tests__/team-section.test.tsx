import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Page-level coverage for the Team Admin surface (task #16/#23).
 *
 * `TeamSection` is the shell used by /admin → Team. It owns:
 *   - a tabs strip (Members + Pending invitations) so the table view
 *     and the invitations queue are reachable from one page
 *   - a single "Invite teammate" button gated on viewerIsAdmin that
 *     opens the 4-step `InviteTeammateWizard`
 *   - the wizard itself (only when viewerIsAdmin)
 *
 * The deep wizard behaviour (email validation, role catalog, delivery
 * gates, server errors) is covered by `invite-teammate-wizard.test.tsx`.
 * The Members tab content (role labels, role-change confirmation flow)
 * lives inside `UsersSection` and is covered by its own test file
 * (`features/admin/presentation/sections/__tests__/users-section.test.tsx`).
 * This file owns the *page shell* assertions only.
 */

const { isMementoAdminValue } = vi.hoisted(() => ({
  isMementoAdminValue: { current: false },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => ({
    user: { id: "viewer-id", username: "viewer", role: "admin" },
    refresh: vi.fn(),
    activeOrganizationId: null,
    organizations: [],
    canProvisionInIdp: false,
    idpProvisioningEnabled: true,
  }),
}));

vi.mock("@/features/auth/presentation/role", () => ({
  useIsMementoAdmin: () => isMementoAdminValue.current,
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useListUsers: () => ({ data: [], isLoading: false }),
    useListTeamInvitations: () => ({ data: [], isLoading: false }),
    useCreateTeamInvitation: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useResendTeamInvitation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useRevokeTeamInvitation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useUpdateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useResendWelcomeEmail: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    getListTeamInvitationsQueryKey: () => ["team-invitations"],
    getListUsersQueryKey: () => ["users"],
  };
});

import { TeamSection } from "../team-section";

function renderSection(viewerIsAdmin: boolean) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TeamSection viewerIsAdmin={viewerIsAdmin} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  isMementoAdminValue.current = false;
});

afterEach(() => {
  cleanup();
});

describe("TeamSection", () => {
  it("renders the Team Admin shell with both tabs reachable", () => {
    renderSection(true);
    expect(screen.getByTestId("section-team")).toBeTruthy();
    expect(screen.getByTestId("tab-team-members")).toBeTruthy();
    expect(screen.getByTestId("tab-team-pending-invitations")).toBeTruthy();
  });

  it("shows the Invite teammate button when the viewer is an admin", () => {
    renderSection(true);
    expect(screen.getByTestId("button-invite-teammate")).toBeTruthy();
  });

  it("hides the Invite teammate button and the wizard from non-admin viewers", () => {
    renderSection(false);
    expect(screen.queryByTestId("button-invite-teammate")).toBeNull();
    // The wizard is only mounted for admins; a non-admin should not
    // be able to surface the dialog at all.
    expect(screen.queryByTestId("dialog-invite-teammate")).toBeNull();
  });

  it("opens the 4-step Invite Teammate wizard when the admin clicks the button", () => {
    renderSection(true);
    expect(screen.queryByTestId("dialog-invite-teammate")).toBeNull();
    fireEvent.click(screen.getByTestId("button-invite-teammate"));
    expect(screen.getByTestId("dialog-invite-teammate")).toBeTruthy();
    expect(screen.getByTestId("invite-step-who")).toBeTruthy();
  });

  it("defaults to the Members tab so the admin lands on the user table", () => {
    renderSection(true);
    // Radix Tabs mark the default trigger as data-state="active".
    expect(
      screen
        .getByTestId("tab-team-members")
        .getAttribute("data-state"),
    ).toBe("active");
    expect(
      screen
        .getByTestId("tab-team-pending-invitations")
        .getAttribute("data-state"),
    ).toBe("inactive");
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ROLE_PREDICATES } from "@/features/auth/domain/role";
import { SwitchOrgPrompt } from "../switch-org-prompt";
import { useOrgsMatchingRole } from "../role";

// The hook reads from auth-context; mock it so we can drive
// `organizations` / `activeOrganizationId` / `setActiveOrganization`
// directly without standing up a real provider.
const setActiveOrganization = vi.fn(async (_id: string) => {});
const refresh = vi.fn(async () => {});
const useAuthMock = vi.fn();

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

function wrap(node: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  useAuthMock.mockReset();
  setActiveOrganization.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("useOrgsMatchingRole", () => {
  function Probe({ predicate }: { predicate: Parameters<typeof useOrgsMatchingRole>[0] }) {
    const orgs = useOrgsMatchingRole(predicate);
    return <div data-testid="ids">{orgs.map((o) => o.id).join(",")}</div>;
  }

  it("returns orgs (other than the active one) whose per-org role satisfies the predicate", () => {
    useAuthMock.mockReturnValue({
      organizations: [
        { id: "a", externalKey: "orga", displayName: "OrgA", role: "limited" },
        { id: "b", externalKey: "orgb", displayName: "OrgB", role: "admin" },
        { id: "c", externalKey: "orgc", displayName: "OrgC", role: "limited_admin" },
      ],
      activeOrganizationId: "a",
    });
    render(<Probe predicate={ROLE_PREDICATES.anyAdmin} />);
    expect(screen.getByTestId("ids").textContent).toBe("b,c");
  });

  it("excludes the active org even when it satisfies the predicate", () => {
    useAuthMock.mockReturnValue({
      organizations: [
        { id: "a", externalKey: "orga", displayName: "OrgA", role: "admin" },
        { id: "b", externalKey: "orgb", displayName: "OrgB", role: "admin" },
      ],
      activeOrganizationId: "a",
    });
    render(<Probe predicate={ROLE_PREDICATES.anyAdmin} />);
    expect(screen.getByTestId("ids").textContent).toBe("b");
  });

  it("returns an empty list for local users with no orgs", () => {
    useAuthMock.mockReturnValue({
      organizations: [],
      activeOrganizationId: null,
    });
    render(<Probe predicate={ROLE_PREDICATES.anyAdmin} />);
    expect(screen.getByTestId("ids").textContent).toBe("");
  });
});

describe("SwitchOrgPrompt", () => {
  it("renders nothing when no other org satisfies the predicate", () => {
    useAuthMock.mockReturnValue({
      organizations: [
        { id: "a", externalKey: "orga", displayName: "OrgA", role: "limited" },
      ],
      activeOrganizationId: "a",
      setActiveOrganization,
      refresh,
    });
    wrap(
      <SwitchOrgPrompt
        predicate={ROLE_PREDICATES.anyAdmin}
        pageLabel="Admin"
      />,
    );
    expect(screen.queryByTestId("switch-org-prompt")).toBeNull();
  });

  it("renders a switch button per qualifying org with the per-org role label", () => {
    useAuthMock.mockReturnValue({
      organizations: [
        { id: "a", externalKey: "orga", displayName: "OrgA", role: "limited" },
        { id: "b", externalKey: "orgb", displayName: "OrgB", role: "admin" },
        { id: "c", externalKey: "orgc", displayName: "OrgC", role: "limited_admin" },
      ],
      activeOrganizationId: "a",
      setActiveOrganization,
      refresh,
    });
    wrap(
      <SwitchOrgPrompt
        predicate={ROLE_PREDICATES.anyAdmin}
        pageLabel="Admin"
        testId="admin-switch-org-prompt"
      />,
    );
    expect(screen.getByTestId("admin-switch-org-prompt")).toBeDefined();
    const orgB = screen.getByTestId("admin-switch-org-prompt-button-orgb");
    expect(orgB.textContent).toContain("Switch to OrgB");
    expect(orgB.textContent).toContain("Admin");
    const orgC = screen.getByTestId("admin-switch-org-prompt-button-orgc");
    expect(orgC.textContent).toContain("Switch to OrgC");
    expect(orgC.textContent).toContain("Limited Admin");
  });

  it("calls setActiveOrganization and refresh when the user clicks a switch button", async () => {
    useAuthMock.mockReturnValue({
      organizations: [
        { id: "a", externalKey: "orga", displayName: "OrgA", role: "limited" },
        { id: "b", externalKey: "orgb", displayName: "OrgB", role: "admin" },
      ],
      activeOrganizationId: "a",
      setActiveOrganization,
      refresh,
    });
    wrap(
      <SwitchOrgPrompt
        predicate={ROLE_PREDICATES.anyAdmin}
        pageLabel="Admin"
        testId="admin-switch-org-prompt"
      />,
    );
    fireEvent.click(
      screen.getByTestId("admin-switch-org-prompt-button-orgb"),
    );
    await waitFor(() => {
      expect(setActiveOrganization).toHaveBeenCalledWith("b");
      expect(refresh).toHaveBeenCalled();
    });
  });
});

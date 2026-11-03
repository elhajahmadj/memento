import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AuthOrganization } from "@workspace/api-client-react";

const useAuthMock = vi.fn();

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return {
    ...actual,
    useLocation: () => ["/pick-org", vi.fn()],
  };
});

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

import { PickOrg } from "../pick-org";

function setOrgs(organizations: AuthOrganization[]) {
  useAuthMock.mockReturnValue({
    organizations,
    setActiveOrganization: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  });
}

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
});

describe("PickOrg", () => {
  it("renders each org as 'OrgName - RoleLabel' using the shared role labels", () => {
    setOrgs([
      {
        id: "o1",
        externalKey: "orga",
        displayName: "OrgA",
        role: "limited_admin",
      },
      {
        id: "o2",
        externalKey: "orgb",
        displayName: "OrgB",
        role: "admin",
      },
      {
        id: "o3",
        externalKey: "orgc",
        displayName: "OrgC",
        role: "limited",
      },
    ]);
    render(<PickOrg />);
    expect(screen.getByTestId("pick-org-orga").textContent).toContain(
      "OrgA - Limited Admin",
    );
    expect(screen.getByTestId("pick-org-orgb").textContent).toContain(
      "OrgB - Admin",
    );
    expect(screen.getByTestId("pick-org-orgc").textContent).toContain(
      "OrgC - User",
    );
  });

  it("falls back to just the org name (no trailing separator) when role is missing", () => {
    setOrgs([
      {
        id: "o1",
        externalKey: "orga",
        displayName: "OrgA",
        role: null,
      },
    ]);
    render(<PickOrg />);
    const btn = screen.getByTestId("pick-org-orga");
    expect(btn.textContent).toContain("OrgA");
    expect(btn.textContent).not.toContain(" - ");
  });

  it("does not render the org's external key on the picker", () => {
    setOrgs([
      {
        id: "o1",
        externalKey: "orga-external-key",
        displayName: "OrgA",
        role: "admin",
      },
    ]);
    render(<PickOrg />);
    expect(screen.queryByText("orga-external-key")).toBeNull();
  });
});

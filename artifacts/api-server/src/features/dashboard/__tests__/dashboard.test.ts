import { describe, it, expect } from "vitest";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";

describe("dashboard summary contract", () => {
  it("accepts a minimal limited-user payload (all admin fields null)", () => {
    const payload = {
      role: "limited" as const,
      window: "7d" as const,
      onboarding: null,
      myRecentRuns: [],
      myProjects: [],
      draftsInProgress: [],
      adminProjectsCount: null,
      recentActivityInMyProjects: null,
      orgHealth: null,
      failingTests: null,
      users: null,
      projects: null,
      integrations: null,
      orgs: null,
      systemHealth: null,
    };
    const parsed = GetDashboardSummaryResponse.parse(payload);
    expect(parsed.role).toBe("limited");
    expect(parsed.orgs).toBeNull();
  });

  it("accepts a memento_admin payload with cross-org leaderboard", () => {
    const payload = {
      role: "memento_admin" as const,
      window: "30d" as const,
      onboarding: null,
      myRecentRuns: [],
      myProjects: [],
      draftsInProgress: [],
      adminProjectsCount: 12,
      recentActivityInMyProjects: [],
      orgHealth: { totalRuns: 0, passRate: 0, href: "/tools/test-runs" },
      failingTests: [],
      users: { activeThisWeek: 1, newThisWindow: 0, href: "/admin#users" },
      projects: { total: 12, stale: 2, href: "/projects" },
      integrations: {
        ssoUsers: 0,
        localUsers: 1,
        gitReposWithPat: 0,
        usersHref: "/admin#users",
        gitReposHref: "/admin#git-repos",
      },
      orgs: {
        total: 2,
        leaderboard: [
          {
            organizationId: "00000000-0000-0000-0000-000000000001",
            displayName: "Acme",
            runs: 5,
            href: "/projects?org=00000000-0000-0000-0000-000000000001",
          },
        ],
      },
      systemHealth: {
        apiErrorRate: null,
        recentAdminActions: 7,
        href: "/admin",
      },
    };
    const parsed = GetDashboardSummaryResponse.parse(payload);
    expect(parsed.orgs?.leaderboard).toHaveLength(1);
    expect(parsed.systemHealth?.recentAdminActions).toBe(7);
  });

  it("rejects an unknown role", () => {
    expect(() =>
      GetDashboardSummaryResponse.parse({
        role: "intern",
        window: "7d",
        onboarding: null,
        myRecentRuns: [],
        myProjects: [],
        draftsInProgress: [],
        adminProjectsCount: null,
        recentActivityInMyProjects: null,
        orgHealth: null,
        failingTests: null,
        users: null,
        projects: null,
        integrations: null,
        orgs: null,
        systemHealth: null,
      }),
    ).toThrow();
  });
});

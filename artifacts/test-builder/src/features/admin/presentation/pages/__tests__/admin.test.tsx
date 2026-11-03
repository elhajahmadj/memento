import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthUserRole } from "@workspace/api-client-react";

const navigateMock = vi.fn();
const useAuthMock = vi.fn();
const toastError = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/admin", navigateMock],
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn(), warning: vi.fn() },
}));

// Each admin section pulls data via api-client-react hooks. We stub the
// section components themselves so this test stays focused on the page
// shell + role gating + section visibility rather than re-testing the
// individual section internals (which have their own coverage).
vi.mock("@/features/admin/presentation/sections/manage-projects-section", () => ({
  ManageProjectsSection: (props: {
    canDelete?: boolean;
    canClear?: boolean;
    scoped?: boolean;
  }) => (
    <div
      data-testid="stub-manage-projects-section"
      data-can-delete={String(props.canDelete ?? false)}
      data-can-clear={String(props.canClear ?? props.canDelete ?? false)}
      data-scoped={String(props.scoped ?? false)}
    />
  ),
}));
vi.mock("@/features/admin/presentation/sections/users-section", () => ({
  UsersSection: (props: { viewerIsAdmin?: boolean }) => (
    <div
      data-testid="stub-users-section"
      data-viewer-is-admin={String(props.viewerIsAdmin ?? false)}
    />
  ),
}));
vi.mock("@/features/admin/presentation/sections/azure-repos-section", () => ({
  GitReposSection: () => <div data-testid="stub-git-repos-section" />,
}));
vi.mock("@/features/admin/presentation/sections/approval-section", () => ({
  ApprovalSection: () => <div data-testid="stub-approval-section" />,
}));
vi.mock("@/features/admin/presentation/sections/fork-requests-section", () => ({
  ForkRequestsSection: (props: { canAssign?: boolean }) => (
    <div
      data-testid="stub-fork-requests-section"
      data-can-assign={String(props.canAssign ?? false)}
    />
  ),
}));
vi.mock("@/features/admin/presentation/sections/project-assignments-section", () => ({
  ProjectAssignmentsSection: () => (
    <div data-testid="stub-project-assignments-section" />
  ),
}));
vi.mock("@/features/settings/presentation/sections/architectures-panel", () => ({
  ArchitecturesPanel: (props: { defaultOpen?: boolean }) => (
    <div
      data-testid="settings-section-architectures"
      data-default-open={String(props.defaultOpen ?? false)}
      data-state={props.defaultOpen ? "open" : "closed"}
    />
  ),
}));
vi.mock("@/features/settings/presentation/sections/recording-settings-section", () => ({
  RecordingSettingsSection: () => (
    <div data-testid="stub-recording-section" />
  ),
}));
vi.mock("@/features/settings/presentation/sections/validation-settings-section", () => ({
  ValidationSettingsSection: () => (
    <div data-testid="stub-validation-section" />
  ),
}));

import { Admin } from "../admin";

function setRole(
  role: AuthUserRole,
  extras: {
    organizations?: Array<{
      id: string;
      externalKey: string;
      displayName: string;
      role: "admin" | "limited_admin" | "limited" | null;
    }>;
    activeOrganizationId?: string | null;
  } = {},
) {
  useAuthMock.mockReturnValue({
    user: {
      id: "u",
      username: "u",
      role,
      effectiveRole: role,
      profileComplete: true,
    },
    loading: false,
    logout: vi.fn(),
    organizations: extras.organizations ?? [],
    activeOrganizationId: extras.activeOrganizationId ?? null,
    setActiveOrganization: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  });
}

function renderAdmin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Admin />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", "/admin");
  }
  // jsdom doesn't implement scrollIntoView; admin.tsx calls it
  // via requestAnimationFrame when the hash targets a section.
  if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      () => {};
  }
});

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  useAuthMock.mockReset();
  toastError.mockClear();
});

describe("<Admin /> role gate", () => {
  it("redirects plain users to '/' with an error toast and renders nothing", () => {
    setRole("limited");
    const { container } = renderAdmin();
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
    expect(toastError).toHaveBeenCalledWith("You don't have access to Admin");
    expect(container.textContent).toBe("");
  });

  it("shows an inline 'Switch to <OrgX>' prompt (and does NOT redirect) when the active org fails the gate but another org grants Admin", () => {
    // SSO user is User in the currently-active OrgA but Admin in
    // OrgB. Instead of bouncing to '/' with the access-denied toast,
    // the page should render the SwitchOrgPrompt so the user can
    // one-click into the right org.
    setRole("limited", {
      organizations: [
        { id: "a", externalKey: "orga", displayName: "OrgA", role: "limited" },
        { id: "b", externalKey: "orgb", displayName: "OrgB", role: "admin" },
      ],
      activeOrganizationId: "a",
    });
    renderAdmin();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.getByTestId("admin-switch-org-prompt")).toBeDefined();
    const btn = screen.getByTestId("admin-switch-org-prompt-button-orgb");
    expect(btn.textContent).toContain("Switch to OrgB");
    expect(btn.textContent).toContain("Admin");
    // None of the admin sections should render in the prompt branch.
    expect(screen.queryByTestId("settings-section-users")).toBeNull();
  });

  it("admin sees every admin section (Manage Projects, Users, Git Repos, Code changes, Fork requests, Project assignments) plus Behavior (Architectures, Recording, Validation)", () => {
    setRole("admin");
    renderAdmin();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("settings-section-manage-projects")).toBeDefined();
    expect(screen.getByTestId("settings-section-users")).toBeDefined();
    expect(screen.getByTestId("settings-section-git-repos")).toBeDefined();
    expect(screen.getByTestId("settings-section-approval")).toBeDefined();
    expect(screen.getByTestId("settings-section-fork-requests")).toBeDefined();
    expect(screen.getByTestId("settings-section-project-assignments")).toBeDefined();
    // Behavior group (moved from Settings).
    expect(screen.getByTestId("settings-section-architectures")).toBeDefined();
    expect(screen.getByTestId("settings-section-recording")).toBeDefined();
    expect(screen.getByTestId("settings-section-validation")).toBeDefined();
  });

  it("admin renders Users standalone above the grouped Projects/Source control/Behavior headings", () => {
    setRole("admin");
    renderAdmin();
    // Users is a standalone CollapsibleSection without a group
    // heading, placed before the first GroupHeading ("Projects").
    const groupNames = new Set(["Projects", "Source control", "Behavior"]);
    const groupHeadings = Array.from(document.querySelectorAll("h2"))
      .filter((h) => groupNames.has(h.textContent?.trim() ?? ""));
    expect(groupHeadings.map((h) => h.textContent?.trim())).toEqual([
      "Projects",
      "Source control",
      "Behavior",
    ]);
    const usersSection = screen.getByTestId("settings-section-users");
    const projectsHeading = groupHeadings[0];
    expect(projectsHeading).toBeDefined();
    // DOCUMENT_POSITION_FOLLOWING (4) means usersSection comes
    // before projectsHeading in document order.
    expect(
      usersSection.compareDocumentPosition(projectsHeading!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    ["architectures", "settings-section-architectures"],
    ["recording", "settings-section-recording"],
    ["validation", "settings-section-validation"],
    ["manage-projects", "settings-section-manage-projects"],
    ["users", "settings-section-users"],
    ["git-repos", "settings-section-git-repos"],
    ["approval", "settings-section-approval"],
    ["fork-requests", "settings-section-fork-requests"],
    ["project-assignments", "settings-section-project-assignments"],
  ])(
    "admin landing on /admin#%s opens the matching section",
    (anchor, testId) => {
      window.history.replaceState(null, "", `/admin#${anchor}`);
      setRole("admin");
      renderAdmin();
      const el = screen.getByTestId(testId);
      // CollapsibleSection sets data-state="open" on its content
      // wrapper when defaultOpen is true; the ArchitecturesPanel
      // mock mirrors that contract on its root. Either way, an
      // opened section has a data-state="open" element in its
      // subtree.
      const opened =
        el.getAttribute("data-state") === "open" ||
        el.querySelector('[data-state="open"]') !== null;
      expect(opened).toBe(true);
    },
  );

  it("admin propagates canDelete/viewerIsAdmin to scoped sections", () => {
    setRole("admin");
    renderAdmin();
    expect(
      screen
        .getByTestId("stub-manage-projects-section")
        .getAttribute("data-can-delete"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("stub-manage-projects-section")
        .getAttribute("data-can-clear"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("stub-manage-projects-section")
        .getAttribute("data-scoped"),
    ).toBe("false");
    expect(
      screen.getByTestId("stub-users-section").getAttribute("data-viewer-is-admin"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("stub-fork-requests-section")
        .getAttribute("data-can-assign"),
    ).toBe("true");
  });

  it("limited_admin sees only the sections they can act on (no Git Repos, no Project assignments)", () => {
    setRole("limited_admin");
    renderAdmin();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("settings-section-manage-projects")).toBeDefined();
    expect(screen.getByTestId("settings-section-users")).toBeDefined();
    expect(screen.getByTestId("settings-section-approval")).toBeDefined();
    expect(screen.getByTestId("settings-section-fork-requests")).toBeDefined();
    // Admin-only sections must not render for Limited Admin.
    expect(screen.queryByTestId("settings-section-git-repos")).toBeNull();
    expect(screen.queryByTestId("settings-section-project-assignments")).toBeNull();
    // Behavior panels are admin-only and must not render for Limited Admin.
    expect(screen.queryByTestId("settings-section-architectures")).toBeNull();
    expect(screen.queryByTestId("settings-section-recording")).toBeNull();
    expect(screen.queryByTestId("settings-section-validation")).toBeNull();
    // Manage Projects is scoped (no per-row delete) and viewer-is-admin is false.
    // Limited Admin cannot Delete, but CAN initiate a Clear files approval request.
    expect(
      screen
        .getByTestId("stub-manage-projects-section")
        .getAttribute("data-can-delete"),
    ).toBe("false");
    expect(
      screen
        .getByTestId("stub-manage-projects-section")
        .getAttribute("data-can-clear"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("stub-manage-projects-section")
        .getAttribute("data-scoped"),
    ).toBe("true");
    expect(
      screen.getByTestId("stub-users-section").getAttribute("data-viewer-is-admin"),
    ).toBe("false");
    // Fork requests for limited_admin is read-only (no Assign affordance).
    expect(
      screen
        .getByTestId("stub-fork-requests-section")
        .getAttribute("data-can-assign"),
    ).toBe("false");
  });
});

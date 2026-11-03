import { useEffect, useState } from "react";
import { PageShell } from "@/shared/ui/shell/page-shell";
import {
  useIsAdmin,
  useIsAnyAdmin,
  useIsLimitedAdmin,
} from "@/features/auth/presentation/role";
import {
  SwitchOrgGatePage,
  useSwitchOrgGate,
} from "@/features/auth/presentation/switch-org-gate";
import { CollapsibleSection } from "@/features/settings/presentation/components/collapsible-section";
import { AccessGate } from "@/features/team/presentation/access-gate";
import { ManageProjectsSection } from "../sections/manage-projects-section";
import { TeamSection } from "@/features/team/presentation/team-section";
import { GitReposSection } from "../sections/azure-repos-section";
import { RepoPatsSection } from "../sections/repo-pats-section";
import { NexusKeysSection } from "../sections/nexus-keys-section";
import { SsoDenialsSection } from "../sections/sso-denials-section";
import { SsoAccessRequestsSection } from "../sections/sso-access-requests-section";
import { useListSsoAccessRequests } from "@workspace/api-client-react";
import { ApprovalSection } from "../sections/approval-section";
import { LifecycleRequestsSection } from "../sections/lifecycle-requests-section";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { ForkRequestsSection } from "../sections/fork-requests-section";
import { ProjectAssignmentsSection } from "../sections/project-assignments-section";
import { ProjectCreateRequestsSection } from "../sections/project-create-requests-section";
import { ArchitecturesPanel } from "@/features/settings/presentation/sections/architectures-panel";
import { RecordingSettingsSection } from "@/features/settings/presentation/sections/recording-settings-section";
import { ValidationSettingsSection } from "@/features/settings/presentation/sections/validation-settings-section";

function readHashSection(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash.replace(/^#/, "");
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-4 pb-1">
      {children}
    </h2>
  );
}

function SsoAccessRequestsPendingBadge() {
  const { data } = useListSsoAccessRequests({ includeResolved: false });
  const count = data?.length ?? 0;
  if (count === 0) return null;
  return (
    <span
      className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
      data-testid="badge-sso-access-requests-pending-count"
    >
      {count} pending
    </span>
  );
}

export function Admin() {
  const isAnyAdmin = useIsAnyAdmin();
  const isAdmin = useIsAdmin();
  const isLimitedAdmin = useIsLimitedAdmin();
  const { user } = useAuth();
  const [openSection] = useState<string>(() => readHashSection());
  // If the active org's role fails the gate but another of the user's
  // orgs grants Admin / Limited Admin, the gate hook returns
  // `canPromptSwitch: true` and skips the redirect so we can render an
  // inline "Switch to <OrgX>" prompt instead. Common case: SSO user
  // who is Admin in OrgA but only User in OrgB and lands on /admin
  // while OrgB happens to be active.
  const { canPromptSwitch } = useSwitchOrgGate({
    allowed: isAnyAdmin,
    requires: "anyAdmin",
    pageLabel: "Admin",
  });

  useEffect(() => {
    if (!openSection) return;
    const el = document.querySelector(
      `[data-testid="settings-section-${openSection}"]`,
    );
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [openSection]);

  if (!isAnyAdmin) {
    if (!canPromptSwitch) {
      return (
        <PageShell
          contentClassName="max-w-3xl w-full"
          backTestId="button-admin-back"
        >
          <h1 className="text-3xl font-semibold mb-2">Admin</h1>
          <AccessGate requiredRole="admin" featureName="The Admin area" />
        </PageShell>
      );
    }
    return (
      <SwitchOrgGatePage
        pageLabel="Admin"
        description="Govern projects, users, repos, requests, and recorder behavior for the workspace."
        requires="anyAdmin"
        testId="admin-switch-org-prompt"
        contentClassName="max-w-5xl w-full"
        backTestId="button-admin-back"
      />
    );
  }

  return (
    <PageShell
      contentClassName="max-w-5xl w-full"
      backTestId="button-admin-back"
    >
      <h1 className="text-3xl font-semibold mb-2">Admin</h1>
      <p className="text-muted-foreground mb-8">
        {isAdmin
          ? "Govern projects, users, repos, requests, and recorder behavior for the workspace."
          : "Govern projects and approvals scoped to the projects you've been assigned to."}
      </p>

      <div className="space-y-3">
        <CollapsibleSection
          title="Team"
          description="Members, pending invitations, and roles for your workspace."
          testId="team"
          defaultOpen={openSection === "team" || openSection === "users"}
        >
          <TeamSection viewerIsAdmin={isAdmin} />
        </CollapsibleSection>

        <GroupHeading>Projects</GroupHeading>
        <CollapsibleSection
          title="Manage Projects"
          description="Disable a project to hide it, or delete it permanently from disk."
          testId="manage-projects"
          defaultOpen={openSection === "manage-projects"}
        >
          <ManageProjectsSection
            canDelete={isAdmin}
            canClear={isAdmin || isLimitedAdmin}
            scoped={isLimitedAdmin}
          />
        </CollapsibleSection>

        {isAdmin && (
          <CollapsibleSection
            title="Project assignments"
            description="Assign limited admins to specific projects and review pending access requests."
            testId="project-assignments"
            defaultOpen={openSection === "project-assignments"}
          >
            <ProjectAssignmentsSection />
          </CollapsibleSection>
        )}

        {isAdmin && (
          <CollapsibleSection
            title="Pending deletions"
            description="Approve or reject pending project deletion requests filed by other admins."
            testId="lifecycle-requests"
            defaultOpen={openSection === "lifecycle-requests"}
          >
            <LifecycleRequestsSection
              viewerUserId={user?.id ?? null}
              kind="delete"
            />
          </CollapsibleSection>
        )}

        {isAdmin && (
          <CollapsibleSection
            title="Pending file clears"
            description="Approve or reject pending clear-files requests filed by other admins."
            testId="lifecycle-requests-clear-files"
            defaultOpen={openSection === "lifecycle-requests-clear-files"}
          >
            <LifecycleRequestsSection
              viewerUserId={user?.id ?? null}
              kind="clear_files"
            />
          </CollapsibleSection>
        )}

        <GroupHeading>Source control</GroupHeading>
        {isAdmin && (
          <CollapsibleSection
            title="Project Git Repos"
            description="Per-project Git integration (Azure Repos or GitHub): repo URL, branch, PAT, and pull."
            testId="git-repos"
            defaultOpen={openSection === "git-repos"}
          >
            <GitReposSection />
          </CollapsibleSection>
        )}
        {isAdmin && (
          <CollapsibleSection
            title="Repos PAT"
            description="Manage reusable Git Personal Access Tokens that can be shared across multiple projects."
            testId="repo-pats"
            defaultOpen={openSection === "repo-pats"}
          >
            <RepoPatsSection />
          </CollapsibleSection>
        )}
        {isAdmin && (
          <CollapsibleSection
            title="IdP partner keys"
            description="Per-org identity provider API keys used to provision and message users. Each org admin manages their own org; Memento Admins see all."
            testId="nexus-keys"
            defaultOpen={openSection === "nexus-keys"}
          >
            <NexusKeysSection />
          </CollapsibleSection>
        )}
        {isAdmin && (
          <CollapsibleSection
            title="SSO denials"
            description="See recent SSO sign-ins blocked by the identity provider claim gates so you can grant access in your identity provider."
            testId="sso-denials"
            defaultOpen={openSection === "sso-denials"}
          >
            <SsoDenialsSection />
          </CollapsibleSection>
        )}
        {isAdmin && (
          <CollapsibleSection
            title="SSO access requests"
            description="Review in-app access requests submitted from the SSO deny banner."
            testId="sso-access-requests"
            defaultOpen={openSection === "sso-access-requests"}
            headerBadge={<SsoAccessRequestsPendingBadge />}
          >
            <SsoAccessRequestsSection />
          </CollapsibleSection>
        )}

        <CollapsibleSection
          title="Code changes"
          description="Review code-change submissions from project forks and decide whether to merge them."
          testId="approval"
          defaultOpen={openSection === "approval"}
        >
          <ApprovalSection />
        </CollapsibleSection>

        <CollapsibleSection
          title="Fork requests"
          description="Assign new forks, approve or deny pending fork requests, and delete forks no longer needed."
          testId="fork-requests"
          defaultOpen={openSection === "fork-requests"}
        >
          <ForkRequestsSection canAssign={isAdmin} />
        </CollapsibleSection>

        {isAdmin && (
          <>
            <GroupHeading>Behavior</GroupHeading>
            <ArchitecturesPanel
              defaultOpen={openSection === "architectures"}
            />
            <CollapsibleSection
              title="Recording"
              description="Tune how the recorder treats existing test code."
              testId="recording"
              defaultOpen={openSection === "recording"}
            >
              <RecordingSettingsSection />
            </CollapsibleSection>
            <CollapsibleSection
              title="Validation"
              description="Tune how long validation artifacts are kept on disk."
              testId="validation"
              defaultOpen={openSection === "validation"}
            >
              <ValidationSettingsSection />
            </CollapsibleSection>
          </>
        )}

        {isAdmin && (
          <CollapsibleSection
            title="Project creation requests"
            description="Approve or reject new-project requests submitted by users without create permissions."
            testId="project-create-requests"
            defaultOpen={openSection === "project-create-requests"}
          >
            <ProjectCreateRequestsSection />
          </CollapsibleSection>
        )}
      </div>
    </PageShell>
  );
}

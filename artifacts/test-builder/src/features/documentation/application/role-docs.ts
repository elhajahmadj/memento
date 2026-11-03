import type { AuthUserRole } from "@workspace/api-client-react";
import type { DocFeature, RoleDoc } from "./documentation";

/**
 * Per-role narrative documentation: the pages each role can reach and
 * what they can do there. Split out of `documentation.tsx` so that
 * module stays a small public surface (types + overview + lookup) —
 * this file is pure data and grows every time a role or page is added.
 *
 * NOTE: the live `/documentation` page does NOT read this module; it is
 * driven by `src/lib/docs/matrix.ts` + `content.ts`. Keep the two in
 * rough agreement, but `lib/docs` is the source of truth for what the
 * app actually renders.
 */

const PAGE_PROJECTS: DocFeature = {
  title: "Home — Projects & forks",
  body: [
    "The landing page is your jumping-off point. Admins see tiles for creating a new project, opening an existing one, jumping into Settings, and opening Tools. Limited admins see the same tiles minus 'New Project'. Regular users see a list of the projects they're allowed to fork, plus their submission history.",
    "Open a project to load it into the workbench. If you're a regular user and don't have access yet, request access from this page; an admin will approve or deny it.",
  ],
};

const PAGE_WORKBENCH: DocFeature = {
  title: "Workbench — Recording and editing tests",
  body: [
    "The workbench is split into a file tree (left), the code viewer or live recording canvas (middle), and the test classes panel (right). Pick a file in the tree to view it, or start a recording to drive a real Chromium instance.",
    "Recording targets one of three places: a [Test] method, the BeforeEachAsync hook, or the OneTimeSetUpAsync hook. As you click and type in the embedded browser, actions are written into your selected target. Stop the recording to commit the generated code.",
    "Admins save directly. Regular users finalize by clicking 'Request SDET approval', which opens a submission for an admin to review. You can also create new test classes/methods, rename or delete files, and download the entire solution as a .zip.",
  ],
};

const PAGE_SETTINGS_ARCHITECTURES: DocFeature = {
  title: "Settings — Architectures",
  body: [
    "Architectures are reusable templates for new projects: which projects, folders, files, and starter content the scaffolder should generate. The 'Default' architecture is built in. Admins can create blank architectures, duplicate any architecture, rename them, edit their structure, and delete custom ones.",
    "You can export an architecture to a JSON file and import one (or several) back in. Imports detect duplicate names and let you keep both or rename. If a batch import has failures, you can retry just the ones that failed.",
  ],
};

const PAGE_SETTINGS_PROJECTS: DocFeature = {
  title: "Settings — Projects in the workspace",
  body: [
    "Lists every solution detected in the workspace folder. Admins can hide a project so it stops appearing in the open dialog, or delete it entirely from disk.",
  ],
};

const PAGE_SETTINGS_USERS: DocFeature = {
  title: "Settings — User management",
  body: [
    "Admins manage who can sign in and what role they get (Admin, Limited Admin, or User). You can create local users and change their roles.",
  ],
};

const PAGE_SETTINGS_HOOKS: DocFeature = {
  title: "Settings — Hook backups",
  body: [
    "When a recording overwrites an existing setup hook, the previous body is backed up to disk. Choose how many backups to keep per hook, or clear them all.",
  ],
};

const PAGE_SETTINGS_ACTIVITY: DocFeature = {
  title: "Settings — Activity log",
  body: [
    "A timeline of meaningful actions across the workspace: project scaffolds, recordings, fork requests, approvals, user changes. Admins see everything; limited admins see only entries scoped to the projects they're assigned to.",
  ],
};

const PAGE_TOOLS_APPROVAL: DocFeature = {
  title: "Tools — Code changes (approvals)",
  body: [
    "Pending submissions from forks land here for review. Open one to see the diff per file, then approve to merge the changes back into the canonical project, or reject with a comment explaining why.",
  ],
};

const PAGE_TOOLS_FORK_REQUESTS: DocFeature = {
  title: "Tools — Fork requests",
  body: [
    "When a regular user asks to fork a project, the request shows up here. Approve it to create their fork, deny it, or delete a fork that's no longer needed.",
  ],
};

const PAGE_TOOLS_PROJECT_ASSIGNMENTS: DocFeature = {
  title: "Tools — Project assignments",
  body: [
    "Admins assign limited admins to specific projects so they can manage forks and approvals scoped to just those projects. You can also see and act on pending access requests from limited admins.",
  ],
};

const PAGE_MY_APPROVALS: DocFeature = {
  title: "My submissions",
  body: [
    "Every change you've sent for SDET review, with status (pending / approved / rejected), the reviewer's comment, and a per-file diff of what you submitted.",
  ],
};

const PAGE_PROFILE: DocFeature = {
  title: "Profile",
  body: [
    "Your account details. New users complete their profile here on first sign-in. You can also pick a theme (Light, Dark, or System) from settings.",
  ],
};

const ADMIN_DOC: RoleDoc = {
  role: "admin",
  label: "Admin",
  intro:
    "Admins have full access. You scaffold canonical projects, manage architectures and users, review every fork submission, and assign limited admins to projects.",
  sections: [
    {
      id: "admin-projects",
      title: "Projects & recording",
      summary: "Create and open projects, then record tests in the workbench.",
      features: [PAGE_PROJECTS, PAGE_WORKBENCH],
    },
    {
      id: "admin-settings",
      title: "Settings",
      summary:
        "Manage architectures, the workspace's projects, users, hook backups, and the activity log.",
      features: [
        PAGE_SETTINGS_ARCHITECTURES,
        PAGE_SETTINGS_PROJECTS,
        PAGE_SETTINGS_USERS,
        PAGE_SETTINGS_HOOKS,
        PAGE_SETTINGS_ACTIVITY,
      ],
    },
    {
      id: "admin-tools",
      title: "Tools",
      summary:
        "Approve code-change submissions, manage fork requests, and assign limited admins to projects.",
      features: [
        PAGE_TOOLS_APPROVAL,
        PAGE_TOOLS_FORK_REQUESTS,
        PAGE_TOOLS_PROJECT_ASSIGNMENTS,
      ],
    },
    {
      id: "admin-account",
      title: "Your account",
      summary: "Profile and theme settings.",
      features: [PAGE_PROFILE],
    },
  ],
};

const LIMITED_ADMIN_DOC: RoleDoc = {
  role: "limited_admin",
  label: "Limited Admin",
  intro:
    "Limited admins are scoped to the projects an admin assigns to them. You can open those projects, record tests, manage architectures, review submissions, and approve/deny fork requests for your assigned projects.",
  sections: [
    {
      id: "limited-projects",
      title: "Projects & recording",
      summary:
        "Open the projects you're assigned to and record tests in the workbench.",
      features: [PAGE_PROJECTS, PAGE_WORKBENCH],
    },
    {
      id: "limited-settings",
      title: "Settings",
      summary:
        "Architectures, hook backups, and activity scoped to your assigned projects.",
      features: [
        PAGE_SETTINGS_ARCHITECTURES,
        PAGE_SETTINGS_HOOKS,
        PAGE_SETTINGS_ACTIVITY,
      ],
    },
    {
      id: "limited-tools",
      title: "Tools",
      summary:
        "Review code-change submissions and manage fork requests for your assigned projects.",
      features: [PAGE_TOOLS_APPROVAL, PAGE_TOOLS_FORK_REQUESTS],
    },
    {
      id: "limited-account",
      title: "Your account",
      summary: "Profile and theme settings.",
      features: [PAGE_PROFILE],
    },
  ],
};

const USER_DOC: RoleDoc = {
  role: "limited",
  label: "User",
  intro:
    "Users work in personal forks of the projects they've been granted access to. You record tests in your fork and submit the changes for an SDET to review.",
  sections: [
    {
      id: "user-projects",
      title: "Your forks",
      summary:
        "Request access to projects, request a fork, then open your fork in the workbench.",
      features: [PAGE_PROJECTS],
    },
    {
      id: "user-recording",
      title: "Recording in the workbench",
      summary:
        "Record interactions into a test method or shared hook, then submit the result for SDET approval.",
      features: [PAGE_WORKBENCH],
    },
    {
      id: "user-submissions",
      title: "My submissions",
      summary: "Track what you've sent for review and read the SDET's reply.",
      features: [PAGE_MY_APPROVALS],
    },
    {
      id: "user-account",
      title: "Your account",
      summary: "Profile and theme settings.",
      features: [PAGE_PROFILE],
    },
  ],
};

const GUEST_DOC: RoleDoc = {
  role: "guest",
  label: "Guest",
  intro:
    "Guest sessions let you try memento without an account. You get one project for six hours — record a UI, API, or performance suite, then export it before the session ends. Everything is permanently deleted when the timer runs out, so download anything you want to keep. AI features and the setup surfaces (network mocks, shared steps, architectures) are not included.",
  sections: [
    {
      id: "guest-project",
      title: "Your one project",
      summary:
        "Create a single project in any supported language, open it, and export it as a zip.",
      features: [PAGE_PROJECTS],
    },
    {
      id: "guest-recording",
      title: "Recording in the workstation",
      summary:
        "Record interactions, add assertions, and run Validate — the full workstation, minus the AI helpers.",
      features: [PAGE_WORKBENCH],
    },
    {
      id: "guest-account",
      title: "Appearance",
      summary:
        "Theme and navigation-layout preferences. Guests have no profile to complete.",
      features: [PAGE_PROFILE],
    },
  ],
};

export const ROLE_DOCS: Record<AuthUserRole, RoleDoc> = {
  memento_admin: ADMIN_DOC,
  admin: ADMIN_DOC,
  limited_admin: LIMITED_ADMIN_DOC,
  limited: USER_DOC,
  guest: GUEST_DOC,
};

export function docsForRole(role: AuthUserRole | null): RoleDoc[] {
  if (role === "memento_admin" || role === "admin") {
    // Admins see every role's documentation, with their own first.
    // Guest docs are included so admins can see what a trial visitor
    // gets without having to start a guest session themselves.
    return [ADMIN_DOC, LIMITED_ADMIN_DOC, USER_DOC, GUEST_DOC];
  }
  if (role === "limited_admin") return [LIMITED_ADMIN_DOC];
  if (role === "limited") return [USER_DOC];
  if (role === "guest") return [GUEST_DOC];
  return [];
}

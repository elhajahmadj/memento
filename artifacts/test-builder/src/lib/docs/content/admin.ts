import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "admin",
    heading: "Admin — Overview",
    intro:
      "Admin is the top-level home for governance work: managing projects, users, per-project git integration, a workspace-wide PAT library for Git providers, code-change approvals, fork requests, and project assignments. The collapsible panels that used to live under Settings (Manage Projects, Users, Project Git Repos, Repos PAT) and Tools (Code changes, Fork requests, Project assignments) all live here on a single page. Full admins see every panel; Limited Admins see Manage Projects, Users, Code changes, and Fork requests scoped to the projects they're assigned to.",
    walkthrough: [
      "Open Admin from the top nav (admins and limited admins only).",
      "Click any section header to expand it. Deep-links from the older URLs (/settings/users, /tools/approval, etc.) automatically scroll to and open the matching section here.",
    ],
    fields: [
      { name: "Manage Projects", description: "Enable/disable projects and (admins) delete them from disk. Limited Admins see only assigned projects." },
      { name: "Users", description: "Manage every user's role and profile. Authorize pending users, edit profiles, resend SSO welcome emails, and delete accounts." },
      { name: "Project Git Repos", description: "Admin-only. Configure per-project Azure Repos / GitHub integration and Pull / Push. (Renamed from 'Git Repos' to make the per-project scope explicit alongside the new Repos PAT library.)" },
      { name: "Repos PAT", description: "Admin-only. Workspace-wide library of named, encrypted Personal Access Tokens that projects can share. Rotate a PAT once here and every project pointing at the entry picks up the new credential on its next pull / push / clone." },
      { name: "Code changes", description: "Review pending fork submissions and approve to merge or reject with a comment." },
      { name: "Fork requests", description: "Approve / deny fork-access requests and delete forks that are no longer needed." },
      { name: "Project assignments", description: "Admin-only. Assign Limited Admins to specific projects and review their access requests." },
    ],
  },
];

import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "admin-repos-pat",
    heading: "Admin — Repos PAT",
    intro:
      "Workspace-wide library of named Personal Access Tokens for Git providers (Azure Repos, GitHub). Instead of pasting the same PAT into every project's Project Git Repos row, admins create a named entry here once and then point individual projects at it from the Configure Project Git Repos dialog or the New project → Clone from repo tab. Rotating an entry's PAT propagates to every project that references it on the next pull / push / clone — no per-project re-paste. PAT bytes are encrypted at rest with the server's PROJECT_SECRETS_KEY using the same AES-256-GCM scheme as inline project PATs, and the UI only ever shows the last four characters.",
    walkthrough: [
      "Open Admin → Repos PAT (admin-only).",
      "Click 'Add' to create a new library entry. Pick a Provider (Azure Repos or GitHub), give it a short Name (this is what shows up in the picker on Project Git Repos and Clone from repo), and paste the Personal Access Token.",
      "Click Save. The PAT is encrypted before it touches the database; subsequent visits show only the last four characters and a Replace button.",
      "To rotate a PAT, click Replace on the row and paste the new value. Every project that points at this entry picks up the new credential on its next pull / push / clone — no per-project edit required.",
      "To rename, click Edit and change the Name. The reference is by ID so renames don't break linked projects.",
      "To delete, click Delete. The delete is blocked (with a list of the projects in question) if any project still references the entry; clear the references in Admin → Project Git Repos first.",
      "Check Settings → Activity to see the audit entry (repos_pat_created / repos_pat_renamed / repos_pat_replaced / repos_pat_deleted, never the PAT bytes themselves).",
    ],
    fields: [
      { name: "Add", description: "Create a new library entry. Provider + Name + PAT are required." },
      { name: "Name", description: "Short human-readable label shown in the 'Existing Repo PAT' picker on Configure Project Git Repos and the Clone from repo tab. Must be unique within the workspace." },
      { name: "Provider", description: "Azure Repos or GitHub. Used by Configure / Clone so the picker only offers entries that match the chosen provider." },
      { name: "Personal Access Token", description: "Encrypted at rest with the server's PROJECT_SECRETS_KEY (AES-256-GCM). After save, only the last four characters are shown. Use the Replace button to rotate it." },
      { name: "Edit", description: "Rename a library entry. References are by ID, so projects pointing at the entry are not affected." },
      { name: "Replace", description: "Rotate the PAT bytes. Every project pointing at the entry uses the new value on its next pull / push / clone." },
      { name: "Delete", description: "Remove the entry. Blocked when one or more projects still reference it; the error toast names the projects so you know what to fix first." },
      { name: "Audit", description: "Every create / rename / replace / delete is recorded in Settings → Activity as repos_pat_created / repos_pat_renamed / repos_pat_replaced / repos_pat_deleted with the entry name and provider. The PAT bytes themselves are never logged." },
      { name: "Endpoints", description: "CRUD lives under /api/repos-pats (GET list, POST create, PATCH rename, POST :id/replace, DELETE :id). All routes are admin-only and enforce the same delete-when-referenced guard the UI does." },
    ],
  },
];

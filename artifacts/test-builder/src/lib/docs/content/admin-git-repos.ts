import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "admin-git-repos",
    heading: "Admin — Project Git Repos",
    intro:
      "Per-project Git provider integration. Admins can pick a provider (Azure Repos or GitHub), store an HTTPS clone URL, branch, and Personal Access Token for each project, then click 'Pull from <provider>' to overwrite the project directory with a fresh clone of that branch, or 'Push to <provider>' to commit the current contents and push them back. The PAT can either be typed inline (and stored encrypted on the project's row) or sourced from the workspace-wide Repos PAT library — see Admin → Repos PAT — so multiple projects can share the same credential and rotate it in one place. Inline PATs are encrypted at rest with the server's PROJECT_SECRETS_KEY and never leave the server in plaintext; the UI only ever shows the last four characters. Every pull and push is recorded in the activity log with the commit SHA (or error code), and on pull the previous contents are kept in a single backup directory next to the project for one-step manual rollback. (Renamed from 'Git Repos' to 'Project Git Repos' so it reads as the per-project integration, distinct from the workspace-wide Repos PAT library.)",
    walkthrough: [
      "Open Admin → Project Git Repos.",
      "Pick a project in the list and click Configure.",
      "Choose the Provider (Azure Repos or GitHub), paste the HTTPS clone URL (Azure Repos: dev.azure.com or *.visualstudio.com; GitHub: github.com), and pick the branch (defaults to main).",
      "Pick a PAT source: 'Existing Repo PAT' picks a named entry from the workspace-wide library (Admin → Repos PAT), or 'New inline PAT' lets you paste a PAT that's stored encrypted on this project only.",
      "Click Save. Inline PATs are encrypted before they touch the database; subsequent visits show only the last four characters and a Replace button. When 'Existing Repo PAT' is chosen the saved row only stores the library reference — rotating that library entry later changes which credential this project authenticates with on the next pull / push.",
      "Click the Pull button on a configured project. Confirm the dialog — the project directory is overwritten with a shallow clone of the configured branch and the previous contents are renamed to <project>.bak-<timestamp>.",
      "Click the Push button on a configured project, type a commit message, and confirm. The current contents of the project directory are committed as a new commit on the configured branch and pushed to the remote using the resolved PAT. If the working copy already matches the remote, you'll see a 'Nothing to push' notice instead.",
      "Check Settings → Activity to see the audit entry (success records the commit SHA; failure records the error code).",
    ],
    fields: [
      { name: "Configure / Edit", description: "Opens the editor dialog for the row's project. New projects use 'Configure'; rows that already have a stored PAT show 'Edit'." },
      { name: "Provider", description: "Git provider for this project. Azure Repos uses dev.azure.com or *.visualstudio.com URLs and authenticates with the PAT as the password. GitHub uses github.com URLs and authenticates with the PAT as 'x-access-token:<pat>' (works for both fine-grained and classic PATs)." },
      { name: "Repository URL", description: "HTTPS clone URL. Validated against the selected provider's allowed hosts; any embedded credentials are stripped before storage." },
      { name: "Branch", description: "Branch to clone. Defaults to main." },
      { name: "PAT source — Existing Repo PAT", description: "Pick a named entry from the workspace-wide Repos PAT library (Admin → Repos PAT). The project's row only stores a reference to the library entry — no PAT bytes are duplicated. Rotating the PAT on the library entry propagates to every project that points at it on the next pull / push / clone. A missing or revoked library entry surfaces as a friendly 'Repo PAT not found' toast and aborts before any git command runs." },
      { name: "PAT source — New inline PAT", description: "The original behaviour: paste a PAT that's stored encrypted on this project's row only. Use this when you want a credential scoped to a single project, or when you haven't promoted the PAT into the shared library yet." },
      { name: "Personal Access Token (inline)", description: "Stored encrypted with the server's PROJECT_SECRETS_KEY when the inline source is selected. After save, only the last four characters are shown. Use the Replace button to rotate it." },
      { name: "Pull from <provider>", description: "Admin-only. Shallow-clones the configured branch into a temp directory, validates that the result looks like a memento project (carries .testbuilder.json or matches the existing layout), backs up the live project directory to <project>.bak-<timestamp>, and atomically renames the clone into place. Only the most recent backup is retained." },
      { name: "Push to <provider>", description: "Admin-only. Clones the configured branch into a temp directory, replaces its working tree with the live project files, and runs git add / commit / push back to the configured branch using the stored PAT. The commit author is recorded as 'memento'. The project directory on disk is never modified. If the remote branch has new commits, the push is rejected with a 'push_rejected' error — pull first, then retry." },
      { name: "Audit log entry", description: "Every pull and push (success or failure) appears in Settings → Activity. Pulls are recorded as project_git_pull, pushes as project_git_push, with the repo URL, branch, and either the new commit SHA or an error code (auth_failed / repo_not_found / branch_not_found / push_rejected / not_a_memento_project / git_failed)." },
    ],
  },
];

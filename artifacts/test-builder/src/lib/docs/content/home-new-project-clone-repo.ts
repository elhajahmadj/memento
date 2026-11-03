import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "home-new-project-clone-repo",
    heading: "Projects — New project: Clone from repo",
    intro:
      "The admins-only New project dialog is organised as two tabs at the top. The default tab is 'Scaffold a new project' (the original template-based flow); the second tab, 'Clone from repo', bootstraps a brand-new project by cloning an existing memento test solution from a Git remote instead of generating one from a template. Use it when a teammate has already pushed a memento project to Azure Repos or GitHub and you want to bring it into this workspace without copying files by hand.",
    walkthrough: [
      "On the Projects page, click New project to open the dialog.",
      "Switch to the 'Clone from repo' tab.",
      "Pick a Provider (Azure Repos or GitHub) and paste the HTTPS clone URL.",
      "Pick the branch (defaults to main).",
      "Pick a PAT source: 'Existing Repo PAT' to reuse a named entry from the workspace-wide Repos PAT library (Admin → Repos PAT), or 'New inline PAT' to paste a PAT scoped to this project only.",
      "Click Clone. The server shallow-clones the branch into a temp directory, validates that the result looks like a memento project (carries .testbuilder.json or matches a known layout), and atomically renames the clone into the workspace.",
      "The new project is configured with the same provider / URL / branch / PAT selection up-front, so Admin → Project Git Repos Pull / Push works against it without an extra Configure step. Failures (auth_failed / repo_not_found / branch_not_found / not_a_memento_project / git_failed) surface as friendly toasts; every attempt is recorded in Settings → Activity as a `project_clone_from_repo` event.",
    ],
    fields: [
      { name: "Tab — Scaffold a new project", description: "Default tab: the original template-based New project flow (solution name, test project name, namespace, solution type, language). Unchanged by this feature." },
      { name: "Tab — Clone from repo", description: "Bootstrap a project from a Git remote. Takes the same Provider / URL / branch / PAT source pickers as the Project Git Repos Configure dialog." },
      { name: "Provider", description: "Azure Repos (dev.azure.com or *.visualstudio.com) or GitHub (github.com). URL validation and PAT injection are provider-aware, exactly as in Configure." },
      { name: "Repository URL", description: "HTTPS clone URL. Embedded credentials are stripped before storage; the URL is validated against the chosen provider's allowed hosts." },
      { name: "Branch", description: "Branch to clone. Defaults to main." },
      { name: "PAT source — Existing Repo PAT", description: "Pick a named entry from the workspace-wide library (Admin → Repos PAT). The project's row stores only the library reference; rotating the library entry later changes the credential used by every linked project on the next pull / push / clone." },
      { name: "PAT source — New inline PAT", description: "Paste a PAT that's stored encrypted on this project's row only." },
      { name: "Memento-project validation", description: "The clone is rejected with a `not_a_memento_project` errorCode toast unless the repository carries a .testbuilder.json marker file or matches a known scaffolded layout. This stops you from accidentally cloning an unrelated repo into the workspace." },
      { name: "Audit", description: "Every attempt (success or failure) is recorded in Settings → Activity as `project_clone_from_repo` with the repo URL, branch, and either the new project name or the error code." },
    ],
  },
];

import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "home",
    heading: "Projects",
    intro:
      "The Projects page (`/projects`) is your project picker. Admins and limited admins see tiles to scaffold a new project, open an existing project, jump into Settings, and open Tools. Regular users see a list of the projects they're allowed to fork plus their submission history. The top-nav 'Projects' link goes here; 'Home' (`/`) goes to the post-login dashboard.",
    walkthrough: [
      "Pick an action: New project, Open existing, or (admins/limited admins only) Settings or Tools.",
      "Open a project to load it into the workbench.",
      "For New project (admins only), the dialog now opens onto two tabs: 'Scaffold a new project' (the original template-based flow) and 'Clone from repo' (bootstrap a project by cloning an existing memento test solution from Git).",
      "If you're a regular user without access, request access — an admin will approve or deny it.",
      "Limited admins are scoped to their assigned projects; the list reflects only those.",
    ],
    fields: [
      { name: "New project", description: "Admins only: opens the New project dialog with two tabs — 'Scaffold a new project' (templates) and 'Clone from repo' (Git). See the dedicated Projects — New project: Clone from repo doc for the clone tab." },
      { name: "Open existing", description: "Pick a project already on disk and load it into the workbench." },
      { name: "Request access / Request fork", description: "User-only entry points to ask for an admin's approval to work on a project." },
      { name: "My submissions", description: "User-only collapsible listing every change you've sent for SDET review." },
    ],
  },
];

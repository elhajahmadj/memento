import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "admin-manage-projects",
    heading: "Admin — Manage Projects",
    intro:
      "Disable a project to hide it from the open dialog, or delete it permanently from disk. Limited admins see only the projects assigned to them; only full admins can permanently delete.",
    walkthrough: [
      "Open Admin → Manage Projects.",
      "Toggle a project's enabled state to hide it from new opens.",
      "Click Delete (admins only) to permanently remove the project from disk.",
    ],
    fields: [
      { name: "Enable / Disable", description: "Hide a project from the open dialog without deleting it." },
      { name: "Delete", description: "Permanently remove the project from disk. Admins only. When more than one admin exists, the delete is filed as a pending deletion request that another admin must approve before any files are removed; sole admins are warned and asked to acknowledge the irreversible action before the project is deleted immediately." },
      { name: "Approval audit trail", description: "Every step of an approval-gated delete is recorded in Settings → Activity: project_delete_requested when filed, project_delete_approved or project_delete_rejected on decision (with the deciding admin and any decision note), and project_delete_executed once the files are actually removed." },
    ],
  },
];

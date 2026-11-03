import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "admin-fork-requests",
    heading: "Admin — Fork requests",
    intro:
      "When a regular user asks to fork a project, the request shows up here. Approve to create their fork, deny to refuse, or delete a fork that's no longer needed.",
    walkthrough: [
      "Open Admin → Fork requests.",
      "Review pending requests; click Approve or Deny.",
      "Use the Existing forks tab to delete forks that are no longer in use.",
    ],
    fields: [
      { name: "Pending requests", description: "Awaiting your decision." },
      { name: "Existing forks", description: "Forks already created; can be deleted from here." },
    ],
  },
];

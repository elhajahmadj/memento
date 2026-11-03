import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "admin-project-assignments",
    heading: "Admin — Project assignments",
    intro:
      "Admin-only. Assign limited admins to specific projects so they can manage forks and approvals scoped to just those projects. Pending access requests from limited admins also surface here.",
    walkthrough: [
      "Open Admin → Project assignments.",
      "Pick a limited admin from the list.",
      "Toggle the projects they should be scoped to.",
      "Resolve pending requests by approving or denying them.",
    ],
    fields: [
      { name: "Limited admin list", description: "Every user with the limited_admin role." },
      { name: "Project toggles", description: "Which projects this limited admin can manage." },
      { name: "Pending requests", description: "Limited admins asking for access to a project." },
    ],
  },
];

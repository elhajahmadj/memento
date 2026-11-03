import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "admin-lifecycle-requests",
    heading: "Admin — Pending deletions",
    intro:
      "Approve or reject pending project deletion requests filed by other admins. Limited admins do not see this section. The admin who originally requested a deletion cannot approve their own request — a second admin must decide. Approving permanently removes the project from disk; rejecting leaves the project intact and records the reviewer's note in the activity log.",
    walkthrough: [
      "Open Admin → Pending deletions.",
      "Review each pending request — requester, project, and any note the requester left.",
      "Click Approve to permanently delete the project, or Reject and leave a comment.",
      "Open Settings → Activity to see the request, decision, and execution audit entries.",
    ],
    fields: [
      { name: "Requester", description: "The admin (or limited admin) who originally filed the deletion request." },
      { name: "Project", description: "Project the deletion would affect; the link jumps to its workbench so you can sanity-check before deciding." },
      { name: "Approve", description: "Admins only. Marks the request approved and immediately deletes the project files from disk. Records project_delete_approved and project_delete_executed audit events naming you as the deciding admin." },
      { name: "Reject", description: "Admins only. Marks the request rejected, leaves the project untouched, and records your decision note in the activity log under project_delete_rejected." },
    ],
  },
];

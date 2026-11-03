import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "admin-approval",
    heading: "Admin — Code changes",
    intro:
      "Pending submissions from forks land here for review. Open one to see a per-file diff, then approve to merge the changes back into the canonical project, or reject with a comment explaining why.",
    walkthrough: [
      "Open Admin → Code changes.",
      "Pick a tab: Pending, Approved, Rejected, or All.",
      "Click a submission to expand its diff.",
      "Click Approve to merge the change, or Reject and leave a comment.",
    ],
    fields: [
      { name: "Status tabs", description: "Filter submissions by review status." },
      { name: "Per-file diff", description: "Side-by-side view of the proposed change for every touched file." },
      { name: "Approve / Reject", description: "Final decision; rejection requires a comment." },
    ],
  },
];

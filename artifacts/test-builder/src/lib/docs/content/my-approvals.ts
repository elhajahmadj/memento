import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "my-approvals",
    heading: "My submissions",
    intro:
      "Users only. Every change you've sent for SDET review, with status (pending / approved / rejected), the reviewer's comment, and a per-file diff of what you submitted.",
    walkthrough: [
      "Open My submissions from the top nav.",
      "Pick a submission to expand its diff and reviewer comment.",
      "Use the status filter to focus on Pending, Approved, or Rejected.",
    ],
    fields: [
      { name: "Status", description: "Pending / Approved / Rejected." },
      { name: "Reviewer comment", description: "What the SDET said when approving or rejecting." },
      { name: "Per-file diff", description: "Exactly what you submitted, file by file." },
    ],
  },
];

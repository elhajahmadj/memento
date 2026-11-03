import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "settings-validation",
    heading: "Admin — Validation retention",
    intro:
      "Validation traces accumulate quickly. This panel sets how long validation artifacts are kept on disk before automatic cleanup runs.",
    walkthrough: [
      "Open Admin → Validation.",
      "Set the retention window (in days).",
      "Older traces are pruned the next time the cleanup task runs.",
    ],
    fields: [
      { name: "Retention window", description: "Days before validation artifacts are eligible for deletion." },
    ],
  },
];

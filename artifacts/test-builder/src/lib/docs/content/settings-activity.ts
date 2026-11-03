import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "settings-activity",
    heading: "Tools — Activity log",
    intro:
      "A single timeline of meaningful actions across the workspace: project scaffolds, recordings, fork requests, approvals, and user changes. Limited admins see only entries for the projects they're assigned to. Lives under Tools as its own page (/tools/activity).",
    walkthrough: [
      "Open Tools → Activity.",
      "Scroll the timeline; entries are newest first.",
      "Click an entry's project link to jump to that project.",
    ],
    fields: [
      { name: "Timestamp", description: "When the action happened, relative to now." },
      { name: "Actor", description: "The user who performed the action." },
      { name: "Action", description: "What changed (project / file / approval / role)." },
      { name: "Project", description: "Project the entry is scoped to." },
    ],
  },
];

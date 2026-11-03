import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "settings-architectures",
    heading: "Admin — Architectures",
    intro:
      "Architectures are reusable templates for new projects: which projects, folders, files, and starter content the scaffolder generates. The 'Default' architecture is built in.",
    walkthrough: [
      "Click New to start a blank architecture, or duplicate an existing one to seed it.",
      "Use Edit to adjust the architecture's structure (projects, folders, starter files).",
      "Use Rename or Delete on custom architectures (built-ins are read-only).",
      "Click Import to load architecture JSON files; drag-and-drop a folder is supported.",
      "Click Export on a row to download its JSON for sharing or version control.",
    ],
    fields: [
      { name: "New", description: "Create a blank custom architecture." },
      { name: "Import / Export", description: "Round-trip architectures via JSON files." },
      { name: "Duplicate", description: "Clone any architecture into a new editable copy." },
      { name: "Edit / Rename / Delete", description: "Available on custom architectures only; built-ins are read-only." },
    ],
  },
];

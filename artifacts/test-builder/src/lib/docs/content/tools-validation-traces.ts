import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "tools-validation-traces",
    heading: "Tools — Validation traces",
    intro:
      "Admin-only. Browse stored validation traces — the recorded artifacts produced when a recording is validated. Useful for debugging why a generated test misbehaves.",
    walkthrough: [
      "Open Tools → Validation traces.",
      "Filter by project / date.",
      "Open a trace to inspect its files (screenshots, DOM snapshots, action log).",
    ],
    fields: [
      { name: "Trace list", description: "Recent traces, newest first." },
      { name: "Trace detail", description: "Per-step screenshot, DOM snapshot, and action log." },
    ],
  },
];

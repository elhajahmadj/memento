import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "tools-internal-tests",
    heading: "Tools — Internal tests runner",
    intro:
      "Admin-only. When the api-server runs against the source tree (not the production bundle), this page exposes the project's own internal test suites and lets you trigger a run from the browser.",
    walkthrough: [
      "Open Tools → Internal tests.",
      "Pick a suite to run.",
      "Click Run; live logs stream into the panel.",
      "Inspect the status badge — Running, Passed, Failed, or Errored — when the run finishes.",
    ],
    fields: [
      { name: "Suite list", description: "Every internal test suite the runner discovers." },
      { name: "Run / Cancel", description: "Trigger or interrupt a run." },
      { name: "Live log", description: "Streaming output, capped at the most recent 5,000 lines." },
      { name: "Status badge", description: "Final state of the run." },
    ],
  },
];

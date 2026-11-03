import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-run-all",
    heading: "Workbench — Run all tests",
    intro:
      "The Validation panel on the Workbench has a 'Validate all' button (also surfaced as 'Run all tests') that replays every recorded suite in the current project as a single batched run. It uses the same Playwright JS replay engine as per-recording Validate, but enqueues every action set in the project at once and streams per-suite progress back into the panel. Each batched run produces one row per recording in the run history under `/tools/test-runs`, so you can see pass/fail trends across recordings over time.",
    walkthrough: [
      "Open the Workbench for a project that has at least one recorded suite.",
      "Open the Validation panel (right-hand side of the workbench).",
      "Click 'Validate all'. The panel calls `POST /api/validation/runs` with `{ all: true }` and immediately shows the per-suite queue.",
      "Watch each row transition: pending → running → passed / failed. Each row links to its trace zip and final-state screenshot.",
      "Click 'Open run' on any row to drill into a single suite's step-by-step output (the same view used when validating a single recording).",
      "When the batch finishes, jump to `/tools/test-runs` to see the run rolled up alongside historical runs and per-test trend lines.",
    ],
    fields: [
      { name: "Validate all button", description: "Top-of-panel control that enqueues every recorded suite in the project as one batch run." },
      { name: "Per-suite queue", description: "One row per recording in the project, with live status (pending / running / passed / failed)." },
      { name: "Trace + final screenshot", description: "Each completed row links to its Playwright trace zip and a JPEG of the final-state DOM." },
      { name: "Open run", description: "Drill into a single suite's step-by-step output, identical to per-recording Validate." },
      { name: "Run history link", description: "Jumps to `/tools/test-runs` filtered to this project so you can see the batch alongside earlier runs." },
      { name: "Audit trail", description: "Each enqueue is logged via `enqueueValidateAll` so admins can trace who launched the batch and when." },
    ],
  },
];

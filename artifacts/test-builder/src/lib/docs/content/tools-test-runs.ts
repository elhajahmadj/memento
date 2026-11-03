import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "tools-test-runs",
    heading: "Tools — Test runs history",
    intro:
      "A newest-first dashboard of the most recent validation runs for the active project, rolling up both individual replay runs and batched 'Validate all' / 'Run all tests' runs. Use it to see which recordings are passing, spot flaky tests at a glance via the inline sparkline, and drill into any past run for its step-by-step report, final screenshot, and downloadable Playwright trace.",
    walkthrough: [
      "Open Tools → Test runs.",
      "Skim the 'Run history (newest first)' table — each row shows status, the recording (file › method, or '(all tests)' for a batch), how long ago it was queued, and how long it took.",
      "Click a row to expand it inline; the drilldown fetches the full run detail and shows every step, the final-state screenshot, and a 'Download trace' link if a Playwright trace was captured.",
      "Use 'Show more' at the bottom of the table to load older runs in pages of 20.",
      "Scroll to 'Per-test trends' to see one row per recording with its pass-rate, flakiness %, and a sparkline of the last 10 runs (newest on the right).",
      "Click 'Run all tests' in the top-right to queue a fresh validation of every recording; the table will refresh automatically every 5 seconds while runs are in flight.",
      "Click 'Refresh' to fetch the latest runs immediately without waiting for the next poll.",
    ],
    fields: [
      {
        name: "Status badge",
        description:
          "Passed, Failed, Error, Running, or Queued. 'Failed' means the test ran to completion with a failing assertion; 'Error' means the runner itself blew up (browser crashed, trace upload failed, etc.) before a verdict was reached.",
      },
      {
        name: "Recording label",
        description:
          "Identifies what was run: '<file> › <method>' for a single test, just the filename for a file-level run, or '(all tests)' for a batch parent. Rows tagged 'child of batch' belong to a parent 'Run all tests' invocation.",
      },
      {
        name: "Trace link",
        description:
          "Downloads the Playwright trace .zip for that run when one is available. Open it with `npx playwright show-trace` to step through the recorded actions, network calls, and DOM snapshots.",
      },
      {
        name: "Run detail (expanded row)",
        description:
          "Lazily fetched per-step report: each action (navigate / click / fill / assert / …) with its status icon, duration, and error message if it failed. Parent batch rows show an aggregate of passed / failed / errored / planned children instead of steps.",
      },
      {
        name: "Final screenshot",
        description:
          "Last-frame screenshot captured by the runner, useful for confirming what the page looked like at the moment the test finished or failed. Only appears on runs that produced one.",
      },
      {
        name: "Show more",
        description:
          "Loads the next page of older runs (20 at a time) into the history table. The remaining count is shown on the button.",
      },
      {
        name: "Per-test trends",
        description:
          "One row per recording, scoped to the last 30 days and last 10 runs of that test. Batch parent rows are excluded so the aggregates reflect individual-test health.",
      },
      {
        name: "Pass rate",
        description:
          "Share of finished runs in the window that passed. Queued and Running runs are excluded from both numerator and denominator so an in-flight retry doesn't temporarily skew the number.",
      },
      {
        name: "Flakiness %",
        description:
          "Status-flip rate over consecutive finished runs in the window: 0% means every run had the same outcome (perfectly stable, even if always failing), 100% means the verdict alternates every run. Use this — not pass rate — to find genuinely flaky tests, since a test that fails consistently has 0% flakiness.",
      },
      {
        name: "Sparkline",
        description:
          "Inline bar chart of the last 10 runs for that test, newest on the right. Green = passed, red = failed/errored, amber = running, grey = queued. A solid green bar means stable, alternating colours mean flaky.",
      },
      {
        name: "Run all tests",
        description:
          "Queues a fresh validation of every recording in the project. A new batch parent run plus one child run per recording will appear at the top of the history within a few seconds; the page polls every 5 seconds while runs are in flight.",
      },
      {
        name: "Refresh",
        description:
          "Immediately re-fetches the run history without waiting for the 5-second poll. Useful if you've just kicked off a run from another tab.",
      },
    ],
  },
];

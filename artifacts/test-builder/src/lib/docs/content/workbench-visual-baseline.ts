import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-visual-baseline",
    heading: "Workbench — Visual baselines",
    intro:
      "Pixel-diff regression catching, baked into Validate. The Add-assertion dialog exposes a `Visual baseline` kind that screenshots the full page during replay and compares it against a saved baseline using pixelmatch. The first run creates the baseline (the step passes with a `visual-baseline-created` event); every subsequent run computes a diff ratio and fails when it exceeds the configured threshold. Baselines are stored per project on the api-server's disk, so two projects (or two forks of the same project) cannot collide on a shared name.",
    walkthrough: [
      "From an active recording, open the Add-assertion dialog (right-click → Add assertion, or Insert assertion above / below from a row's menu).",
      "Pick `Visual baseline` from the assertion-kind dropdown.",
      "Give the baseline a name (filename-safe; e.g. `home-loaded`). This becomes the on-disk filename `<project>/<name>.png` under the api-server's `.validation-baselines/` directory.",
      "Pick a diff threshold (default `0.02` = 2% of pixels). Anything above this fails the step.",
      "Click Add. The step is appended as an `assert` action with `assertKind: \"visual-baseline\"`.",
      "Validate the recording for the first time. The api-server screenshots the page (full-page PNG), saves it as the baseline, and emits a `visual-baseline-created` event — the step passes.",
      "Validate again later. The new screenshot is compared to the baseline pixel-by-pixel via pixelmatch. The Validation panel renders the diff ratio and a link to the on-disk diff PNG; the step fails when the ratio exceeds the threshold.",
      "When the recording is saved, the codegen emits Playwright's native `expect(page).toHaveScreenshot(<name>.png, { maxDiffPixelRatio })` (Node.js / TS) or the equivalent per-language call so the assertion runs identically inside `dotnet test` / `pytest` / `mvn test`.",
    ],
    fields: [
      { name: "Baseline name", description: "Filename-safe identifier; persisted to `<api-server cwd>/.validation-baselines/<sanitized-project>/<name>.png`. Reusing a name across recordings shares the baseline." },
      { name: "Threshold", description: "Maximum acceptable diff ratio (0.0 – 1.0). Default `0.02`; pixelmatch's per-pixel sensitivity is fixed at `0.1`." },
      { name: "First-run capture", description: "When no baseline file exists, replay writes the current screenshot as the baseline and emits a `visual-baseline-created` event. The step always passes on first run; subsequent runs compare against the saved file." },
      { name: "Diff artifact", description: "Each comparison writes `<name>.diff.<timestamp>.png` next to the baseline so you can open the highlighted-diff PNG to see exactly which pixels changed." },
      { name: "Resolution drift", description: "Replay crops both images to the smaller common box before diffing so a small viewport-resolution change does not crash pixelmatch (which requires identical dimensions)." },
      { name: "Per-language codegen", description: "Emits `expect(page).toHaveScreenshot(\"<name>.png\", { maxDiffPixelRatio })` for Node.js, the Python `expect(page).to_have_screenshot(...)`, the Java `assertThat(page).hasScreenshot(...)`, and the C# `await Expect(Page).ToHaveScreenshotAsync(...)` so the assertion behaves identically outside memento." },
    ],
  },
];

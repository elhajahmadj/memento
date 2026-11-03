import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-accessibility",
    heading: "Workbench — Accessibility scans",
    intro:
      "Catch a11y regressions during the same replay that runs your UI tests. The Add-assertion dialog exposes an `Accessibility (axe-core)` kind that injects axe-core into the page, runs a full scan, and fails the step if any violations are found at or above the chosen impact level. The same step kind is also emitted into the generated test in your project's language, so the assertion travels with the recording outside of memento.",
    walkthrough: [
      "From an active recording, open the Add-assertion dialog (right-click → Add assertion, or Insert assertion above / below from a row's menu).",
      "Pick `Accessibility (axe-core)` from the assertion-kind dropdown.",
      "Choose an impact threshold: minor / moderate / serious / critical. The step fails when axe reports any violation at or above this level — the default is `serious`, which mirrors what most teams gate on.",
      "Click Add. The step is appended as an `assert` action with `assertKind: \"accessibility\"`.",
      "Validate the recording. During replay, the api-server runs axe-core against the live page. Failing violations stream into the Validation panel as an `a11y-violations` event and the step is marked failed; the per-violation list (rule id, impact, help text) is shown inline.",
      "When the recording is saved, the codegen emits the per-language axe call: `@axe-core/playwright AxeBuilder` for Node.js, `axe_playwright_python.Axe` for Python, `com.deque.html.axecore.playwright.AxeBuilder` for Java, and `Microsoft.Playwright.Axe` (via the .NET wrapper) for C#. The generated assertion fails on any violation at the chosen impact level.",
    ],
    fields: [
      { name: "Impact threshold", description: "Minimum axe impact level that should fail the step: minor (everything), moderate, serious (default), or critical (only the most severe)." },
      { name: "Live violation feed", description: "During Validate, the Validation panel renders one row per violation with its rule id, impact, target nodes, and help URL — straight from axe's `violations[]` payload." },
      { name: "Pass / fail behaviour", description: "Step passes when axe returns zero violations at or above the threshold; fails with the list of offending rule ids in the error message otherwise." },
      { name: "Per-language codegen", description: "Emits the matching axe-core wrapper for the project's language (`@axe-core/playwright` / `axe-playwright-python` / `axe-core-playwright-java` / .NET axe wrapper). The assertion travels with the saved recording so `dotnet test` / `pytest` / `npx playwright test` / `mvn test` enforce a11y outside memento too." },
      { name: "Storage", description: "The action is persisted as `{ type: \"assert\", assertKind: \"accessibility\", axeImpactLevel }` in the same `recorded_action_sets` row as the rest of the recording." },
    ],
  },
];

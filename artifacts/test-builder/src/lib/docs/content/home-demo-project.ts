import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "home-demo-project",
    heading: "Home — Try the demo project",
    intro:
      "A one-click 'Try the demo' card on the home page scaffolds the `MementoDemo` sample C# solution and seeds it with two pre-recorded test methods, a sample network mock rule, and an accessibility assertion — so you can hit Validate and see every Tier 3 feature (route mocks, API checks, axe-core, visual baselines) end-to-end without recording anything yourself. The seeded actions intentionally target `https://example.com` so the demo is offline-friendly and reliable.",
    walkthrough: [
      "Sign in as an admin (the card lives on the admin home; the limited-user home does not include it).",
      "Click `Try the demo` on the projects landing page. The button calls `POST /api/projects/demo`, which is idempotent — clicking it twice re-attaches you to the existing `MementoDemo` solution rather than scaffolding a duplicate.",
      "When the call returns, you are navigated to `/workbench` with `MementoDemo` loaded as the current project.",
      "Open the Validation panel and click `Validate all` to replay both seeded test methods against `https://example.com`.",
      "Inspect the result: `Demo_VisitsHomePageAndAssertsTitle` covers a navigation + element-has-text + URL-contains assertion; `Demo_RunsAccessibilityAndApiChecks` exercises a route mock, an API status assertion, an axe-core scan, and a visual baseline.",
      "Open Settings → Network mocks for `MementoDemo` to inspect (and edit) the seeded `GET **/api/users/me` mock that the demo recording installs before navigation.",
    ],
    fields: [
      { name: "Try the demo button", description: "Calls `POST /api/projects/demo`. Idempotent — re-attaches to an existing `MementoDemo` solution if one is already on disk." },
      { name: "Sample test methods", description: "`Demo_VisitsHomePageAndAssertsTitle` and `Demo_RunsAccessibilityAndApiChecks` are written into `MementoDemo.Tests/DemoTests.cs` via the same `saveActionSet()` path the recorder uses." },
      { name: "Seeded route mock", description: "A `GET **/api/users/me` rule is created in the per-user `route_mocks` table for the `MementoDemo` project, returning a canned admin user payload." },
      { name: "Seeded a11y + visual assertions", description: "The second test method includes an `accessibility` assertion (axe impact `serious`) and a `visual-baseline` assertion (`demo-home`, threshold `0.05`) so the first Validate run captures a baseline and any future drift fails the step." },
      { name: "Offline-friendly target", description: "Every seeded action targets `https://example.com/`, which is globally cached and tiny — the demo runs fast and works in restricted-network environments." },
      { name: "Server endpoint", description: "`POST /api/projects/demo`, implemented by `ensureDemoProject` in `artifacts/api-server/src/features/demo/infrastructure/demoService.ts`." },
    ],
  },
];

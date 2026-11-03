import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-assertions",
    heading: "Workbench — UI assertion catalog",
    intro:
      "The Add-assertion dialog turns the right-click 'Assert this element' picker into a full no-code assertion catalog. It currently exposes twelve assertion kinds covering element state, count, attribute / value comparison, URL shape, text content, HTTP response status, API request status, axe-core accessibility scans, and pixel-diff visual baselines — so you can express most acceptance criteria without dropping into the generated code.",
    walkthrough: [
      "Inside an active recording session, right-click the element you want to assert on (or open Insert assertion above / below from a recorded-action row's menu).",
      "Pick the assertion kind from the dropdown. The dialog tailors its inputs to the kind (e.g. 'count equals' shows a numeric input, 'attribute equals' shows attribute name + expected value).",
      "For element-targeted kinds (visible / hidden / count / attribute / value / has-text), the dialog pre-fills a stable selector using the recorder's normal priority order (testid → id → jspath → text= → xpath → aria → CSS).",
      "For URL kinds, type the substring (URL contains) or the full URL (URL equals).",
      "For 'response status', pick the HTTP method, type the URL pattern, and the expected status code (e.g. `200`, `4xx`).",
      "Click Add. The assertion is appended to the recording as a typed step and the generated code (per-language `Expect.…` / `assertThat(…)` call) is regenerated.",
    ],
    fields: [
      { name: "Element is visible / Element is hidden", description: "Asserts the targeted selector resolves to an element that is currently visible (or hidden) in the DOM." },
      { name: "Count equals", description: "Asserts the targeted selector matches exactly N elements. Useful for list / table-row assertions." },
      { name: "Attribute equals", description: "Asserts the named attribute on the targeted element matches the expected value (e.g. `aria-checked = \"true\"`)." },
      { name: "Value equals", description: "Asserts a form control's `.value` matches the expected literal (input / textarea / select)." },
      { name: "Element has text", description: "Asserts the targeted element contains the expected substring." },
      { name: "URL contains", description: "Asserts the current page URL contains the given substring at assertion time." },
      { name: "URL equals", description: "Asserts the current page URL exactly matches the given URL." },
      { name: "Response status", description: "Asserts the next matching network request returned the expected HTTP status (method + URL pattern + status code)." },
      { name: "Selector preview", description: "Shows the recorder's chosen selector for the targeted element so you can confirm before committing." },
      { name: "Accessibility (axe-core)", description: "Runs an axe-core scan on the page and fails the step if any violations are found at or above the chosen impact level (minor / moderate / serious / critical). Documented in detail under Workbench — Accessibility scans." },
      { name: "Visual baseline", description: "Captures a full-page PNG and compares it pixel-by-pixel against a saved baseline using pixelmatch; fails when the diff ratio exceeds the configured threshold. Documented in detail under Workbench — Visual baselines." },
      { name: "API status (separate dialog)", description: "Triggered from the Add API check button — performs an out-of-band HTTP request via Playwright's `request.fetch()` and asserts the response status (and optional body). Documented in detail under Workbench — API checks & route mocks." },
    ],
  },
];

import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench",
    heading: "Workbench — Recording and editing tests",
    intro:
      "The workbench is where you record browser interactions into a real Playwright test. The page is split into a file tree (left), the code viewer or live recording canvas (middle), and the test classes panel (right). It only renders if a project is loaded — opening it without one redirects you back to Home.",
    walkthrough: [
      "Pick a file in the tree to view it, or click Start recording to drive a real Chromium instance.",
      "Choose a recording target: a [Test] method, the BeforeEachAsync hook, or the OneTimeSetUpAsync hook.",
      "Interact with the embedded browser. Each click or input is written into the chosen target as a recorded action.",
      "Stop the recording to commit the generated code. Admins save directly; users finalize via 'Request SDET approval'.",
      "Use the right panel to add new test classes/methods, rename or delete files, or download the entire solution as a .zip.",
    ],
    fields: [
      { name: "File tree", description: "Browse the scaffolded project structure. Click a file to view its contents in the editor." },
      { name: "Recording canvas", description: "Live Chromium projection. Right-click an element to add an assertion." },
      { name: "Test classes panel", description: "Create new test classes/methods, rename, delete, or download the project. JMX projects do not generate test classes, so the right panel's Test Suites section is hidden entirely for them — the rest of the right panel (Recorded Actions toolbar, Actions Feed, History, and Test Body Preview) still renders normally." },
      {
        name: "JMX BFF recording mode",
        description:
          "When a JMX project is created with the BFF (Backend-for-Frontend) auth checkbox ticked, `.testbuilder.json` persists `bff: true` and the workbench's JMX recorder branches into BFF-aware capture: every captured request is classified as `bff` / `idp` / `upstream` (live-broadcast to the recorder UI and emitted as three grouping controllers — `BFF`, `IdP`, `Upstream API` — in the .jmx file), the OAuth `state` / `code` / `nonce` literals seen on the authorize redirect are lifted into JMeter variables via Regex Extractors and substituted on every consumer sampler, the double-submit `XSRF-TOKEN` cookie + `X-XSRF-TOKEN` header pair is rewritten to `${csrf_token}` so the load test can re-correlate it per iteration, and the browser's full `storageState` (cookies + localStorage for the live origin) is captured on stop and persisted into the `auth_states` row keyed by (you, this project) so the saved login can be replayed by other recordings. Non-BFF JMX projects pay zero overhead for any of this and emit a single flat sampler list.",
      },
      {
        name: "Test discovery (Explorer → Tests tab)",
        description:
          "The Explorer's Tests tab lists every test method the server can discover across all four supported languages. For C# specifically, both NUnit (`[Test]` / `[TestCase]` with `[Category(\"…\")]`) and xUnit (`[Fact]` / `[Fact(Skip=\"…\")]` / `[Theory]` with `[Trait(\"Category\",\"…\")]`) test methods are discovered, so recorder-emitted API tests under `{Solution}.Automation.API.Tests/Tests/` show up under the **API** filter the moment they're written.",
      },
      { name: "Recording target", description: "Pick where actions are written: a test method, BeforeEachAsync, or OneTimeSetUpAsync." },
      { name: "Request SDET approval", description: "User-only button that opens a submission for an admin to review." },
      {
        name: "Test Category — Constant name",
        description:
          "Optional PascalCase identifier (e.g. `Smoke`) the per-language codegens write into the suite's `TestCategories/{Suite}TestCategories` constants file as `public const string {ConstantName} = \"{value}\"` (or the language equivalent). Must be paired with a Category value — the dialog rejects half-supplied pairs inline and the API rejects them with HTTP 400.",
      },
      {
        name: "Test Category — Value",
        description:
          "Optional category string (e.g. `smoke-tests`) paired with the Constant name. The pair is both-or-neither: either both fields are non-empty or both are blank. The chosen category is also emitted as a per-language attribute on the generated test method — `[Category(TestCategories.Smoke)]` in C#/NUnit, `@pytest.mark.smoke_tests` in Python, `test.describe.configure({ tag: '@smoke-tests' })` in Node.js Playwright, and `@Tag(\"smoke-tests\")` in JUnit 5.",
      },
      {
        name: "Per-suite Constants + TestCategories layout",
        description:
          "When a category is supplied the codegen ensures two sibling files exist next to the suite's test class: `Constants/{Suite}Constants.{ext}` (project-wide constants the suite reuses) and `TestCategories/{Suite}TestCategories.{ext}` (the category constants file the test attribute references). Re-recording with the same Constant name is idempotent — the file is updated in-place, never duplicated.",
      },
      {
        name: "Ignore this test",
        description:
          "Optional checkbox. When ticked the codegen decorates the generated test with the language-appropriate skip/ignore attribute and the reason text you supply: `[Ignore(\"…\")]` in C#/NUnit, `@pytest.mark.skip(reason=\"…\")` in Python, `test.skip(\"…\", …)` in Node.js Playwright, and `@Disabled(\"…\")` in JUnit 5. The reason is required when the checkbox is on; leaving the checkbox off emits no decorator and the test runs normally.",
      },
    ],
  },
];

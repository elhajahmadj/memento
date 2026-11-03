import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-ai-run",
    heading: "Workbench — AI run status",
    intro:
      "Live status surface for a single AI test-authoring run started from the workbench Build with AI button. Polls the run until it terminates and shows every step the agent executed plus the test files it materialized into the project. The Build with AI dialog itself is documented here too — suite-target choices, optional method name, the existing-suite dropdown, and the recorded-setup reuse behavior all show up before you ever land on this page.",
    walkthrough: [
      "From the workbench, click Build with AI.",
      "Pick a Suite target: New test suite (the AI scaffolds a brand-new file) or Add method to existing suite (the AI adds a new [Test] into a class you pick from the dropdown).",
      "Pick a Target method: new [Test], [SetUp] hook, or [OneTimeSetUp] hook.",
      "Suite name is required for new-suite mode. Test method name is required when the target is a new [Test] in a new suite; in Add-method-to-existing mode it is optional — leave it blank and the AI derives a Given_When_Then name from your plan, or fill it in to pin a specific identifier.",
      "Paste or upload a plain-English plan and click Start AI run.",
      "You're taken here automatically. The page refreshes every ~1.5 s until the run reports succeeded or failed.",
      "Inspect the step list and the materialized files; the new test files are immediately visible in the workbench file tree.",
    ],
    fields: [
      { name: "Status", description: "pending / running / succeeded / failed." },
      { name: "Plan", description: "The exact plain-English plan the agent received. In Add-method-to-existing mode against a suite that has a recorded setup, this includes the setup plan lines prepended as context — the generated method body only covers the new steps." },
      { name: "Steps", description: "Per-step trace of what the agent did, with a per-step ok flag." },
      { name: "Materialized files", description: "List of test files the agent wrote into the project tree, with byte sizes." },
      {
        name: "C# suite filename rule",
        description:
          "A brand-new AI-authored C# suite is written as Tests/{Stem}TestSuite.cs containing class {Stem}TestSuite : TestFixture — typing `Login` produces `Tests/LoginTestSuite.cs` with `class LoginTestSuite`. Only the test file picks up the `TestSuite` suffix; sibling Page Object, Selectors, Interfaces, and Actions files keep their existing per-page naming (`{Page}Page.cs`, `{Page}Selectors.cs`, `I{Page}Page.cs`, `{Page}Actions.cs`). Python, Node.js, and Java filenames are unchanged.",
      },
      {
        name: "Add method to existing suite — companion file",
        description:
          "Picking *Add method to existing suite* and a real suite file emits the new [Test] into that exact class via a sibling `{ClassName}.AiMethod.{shortRunId}.cs` declared as `public partial class {ClassName}` (no `: TestFixture`, no `[TestFixture]`). C# merges the partials at build time so the method becomes part of your existing class. The runner never silently scaffolds a second standalone suite in this mode.",
      },
      {
        name: "Existing-suite dropdown filter",
        description:
          "The *Existing suite file* dropdown lists only real suites — files that declare `[TestFixture]` or already contain at least one `[Test]` / `[TestCase]` method. Base / fixture-only classes such as `TestFixture.cs`, pure-hook scaffolds (only `[SetUp]` / `[OneTimeSetUp]` / `[TearDown]`), helpers, POCOs, and `TestCategories/*.cs` are filtered out so you cannot attach a new method to a base class. The list is also filtered by language and the selected Test kind (Playwright UI vs API vs Unit).",
      },
      {
        name: "Recorded [SetUp] plan reused as AI context",
        description:
          "When a Build with AI run targets a [SetUp] or [OneTimeSetUp] hook AND you typed a plan, the runner persists that plan verbatim to a hidden extensionless sidecar `{ClassName}Setup` next to the suite (e.g. `Tests/LoginTestSuiteSetup`). The sidecar is intentionally extensionless so it never appears in the workbench file tree and the test-discovery walker ignores it. Later *Add method to existing suite* runs against the same class read the sidecar back and prepend its lines to your new plan before sending it to the LLM, so the model has full context without you retyping the setup steps. The model is still instructed to emit code only for the new method's steps — the prepended setup lines are context, not steps to re-emit. **Worked example:** the suite `GoogleLogin` has a recorded [SetUp] plan `1) go to www.google.com 2) click login button` (persisted to `Tests/GoogleLoginTestSuiteSetup`). You later add a method with plan `1) fill username 'me@example.com' 2) click Login`. The LLM receives all four lines as context but the generated [Test] method body only performs steps 3 and 4 (the fill + the click).",
      },
    ],
  },
];

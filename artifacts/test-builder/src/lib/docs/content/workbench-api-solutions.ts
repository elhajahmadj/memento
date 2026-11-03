import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-api-solutions",
    heading: "Workbench — API solutions (multi-language)",
    intro:
      "memento can scaffold a non-recorder \"API solution\" in any of the four supported languages — C#, Python, Node.js, or Java. Pick the language in New project → API; the rest of the workflow is identical across languages. There is no recorder and no browser preview for API solutions: the workbench toolbar swaps Start Recording for Build test, and the dialog appends an endpoint constant + a helper method on the project's API testing assistant + a test method, and merges the new URL into the project's settings file. All four atomic writes are rolled back if any one fails. Re-running with the same endpoint or helper name replaces the existing one; duplicate test names in an existing class are refused.",
    walkthrough: [
      "From Home, click New project, choose solution type API, then pick a language (C#, Python, Node.js, or Java). The scaffolder writes the language-appropriate layout (see the Per-language layouts field below).",
      "Open the project. The workbench toolbar shows Build test instead of Start Recording — Build test is admin-only and only enabled on API solutions.",
      "Step 1 (Endpoint & URL): name the endpoint constant (optionally inside a nested section), give it a path, name the URL entry that lands in the settings file, set the base URL, and pick the HTTP verb.",
      "Step 2 (Helper + test): name the helper method on the API testing assistant, declare up to ten typed parameters, optionally add default headers / multipart fields / a Bearer access-token header, pick where the call goes (inside the test, in the constructor, or per-test setup), name the test method, and either create a new test class or add to an existing one.",
      "Submit. memento writes the four files atomically; on any write failure it rolls every file back to its pre-Build-Test content.",
      "Run the generated test with the language's native runner — `dotnet test` (C#), `pytest` (Python), `npx vitest run` (Node.js), or `mvn test` (Java).",
    ],
    fields: [
      {
        name: "Per-language layouts",
        description:
          "C# (xUnit + HttpClient): two-project layout — `{Sln}.Automation.API` (Constants / Infrastructure / Handlers / Extensions, depends on Microsoft.AspNetCore.Mvc.Testing + Polly) and `{Sln}.Automation.API.Tests` (xUnit + FluentAssertions, `Tests/appsettings.json`, an API test collection, and the `APITestingAssistant` partial class). Generated tests carry `[Collection(TestCollections.Api)]`. " +
          "Python (pytest + httpx): a per-solution helper package `automation_api/` (constants, infrastructure including `ApiTestFixture` + retry / logging handlers, handlers, extensions) plus a `tests/` package with `appsettings.json`, `infrastructure/api_test_collection.py`, snake-cased `{class_name}_a_p_i_testing_assistants.py` files, and generated `test_<ClassName>.py` files under `tests/tests/`. The root `conftest.py` registers the shared fixture so generated tests can request `api_fixture` without per-file imports. " +
          "Node.js (Vitest + undici / fetch): a single npm package — `src/automation-api/{constants,infrastructure,handlers,extensions}/*.ts` (kebab-case file names) plus `tests/{appsettings.json, infrastructure/api-test-collection.ts, api-testing-assistants/, tests/}`. Generated tests are `<kebab>.spec.ts` files run by Vitest. " +
          "Java (Maven + JUnit 5 + AssertJ): Maven multi-module — a parent `pom.xml`, a helper module `{sln}-automation-api` (`src/main/java/com/{pkg}/automation/api/{constants,infrastructure,handlers,extensions}/...`, depends on Jackson) and a tests module `{sln}-automation-api-tests` with the API test collection, `apitestingassistants/`, and `tests/` packages. The `ApiTestFixture` is a singleton that loads `appsettings.json` from the test classpath and lazily creates one `java.net.http.HttpClient` per `urlName`. Generated tests carry `@Tag(TestCollections.API)` and assert via AssertJ.",
      },
      {
        name: "Build Test dialog (identical across languages)",
        description:
          "Two-step wizard rendered by `build-test-dialog.tsx`. The wizard fields, validation rules, idempotency rules, and atomic four-file write semantics are the same for every language — only the on-disk layout the writes target differs. The dialog is admin-only and refuses to run on non-API solutions.",
      },
      {
        name: "Shared adapter registries",
        description:
          "Per-language seam on the server: `apiTestScaffolderRegistry` (under `features/projects/infrastructure/`) maps `Language` → scaffolder, and `apiTestCodegenRegistry` (under `features/codegen/infrastructure/`) maps `Language` → codegen. The `/api/api-tests/build` route resolves the codegen via the registry and delegates to `planApiTestBuild` + the shared `commitApiTestPlan`. Stub adapters surface as HTTP 501 with `API test build for <language> is not implemented yet` rendered via `data-testid=\"text-build-test-error\"`.",
      },
      {
        name: "Language-specific gotchas",
        description:
          "C#: requires .NET SDK on the runner. Python: `tests/tests/` is intentional — Python API projects nest the per-suite test files one level deeper than Playwright Python projects. Node.js: every file name is kebab-case (the helper class lives in `<class-name>-api-testing-assistants.ts`). Java: the `{pkg}` portion of the package path is `solutionName` lowercased and stripped of non-alnum (with a `pkg` prefix when the result starts with a digit), so unusual solution names can produce surprising package paths — use a plain alphanumeric solution name to keep things readable.",
      },
      {
        name: "Where to run the generated suite",
        description:
          "C#: `dotnet test` inside `{Sln}.Automation.API.Tests/`. Python: `pytest` from the project root (the conftest auto-loads the fixture). Node.js: `npx vitest run` from the project root. Java: `mvn test` from the project root (Maven discovers both modules from the parent pom). README links to the per-language workflow sections for the full prerequisite list.",
      },
    ],
  },
];

import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-api-build-test-python",
    heading: "Workbench — Build Test (Python)",
    intro:
      "The Build Test dialog opened on a Python API solution. The two-step wizard is identical to the C# / Node.js / Java variants, but the four files it writes target the Python layout: `automation_api/handlers/<endpoint>.py` (the endpoint constants), `automation_api/api_testing_assistant_<class>.py` (the helper method), `tests/tests/test_<class>.py` (the test method), and `tests/appsettings.json` (the merged URL entry). Run the generated suite with `pytest` from the project root — the project's `conftest.py` registers the shared `api_fixture`.",
    walkthrough: [
      "Scaffold or open a Python API solution (New project → API → Python).",
      "From the workbench, click Build test on the toolbar.",
      "Step 1: name the endpoint constant (snake_cased automatically), pick the URL name + base URL, and the HTTP verb.",
      "Step 2: name the helper method on the assistant, declare typed parameters, pick a build target, and choose a test class (new or existing).",
      "Submit. memento writes all four files atomically and rolls back on any failure.",
      "Run `pytest` from the project root to execute the generated test.",
    ],
    fields: [
      { name: "Layout written", description: "`automation_api/` package (constants / infrastructure / handlers / extensions) + `tests/` package (`appsettings.json`, `infrastructure/api_test_collection.py`, snake-cased `<class>_a_p_i_testing_assistants.py`, generated `tests/tests/test_<class>.py`)." },
      { name: "Fixture registration", description: "Root `conftest.py` exposes `api_fixture` so generated test files can request it without per-file imports." },
      { name: "Runner", description: "`pytest` from the project root." },
      { name: "Codegen module", description: "`artifacts/api-server/src/features/codegen/infrastructure/apiPythonCodegen.ts` (registered in `apiTestCodegenRegistry`)." },
    ],
  },
];

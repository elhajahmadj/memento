import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-api-build-test-java",
    heading: "Workbench — Build Test (Java)",
    intro:
      "The Build Test dialog opened on a Java API solution. Same two-step wizard as the other languages; the four files it writes target the Maven multi-module Java layout. Generated tests carry `@Tag(TestCollections.API)` and assert via AssertJ; run them with `mvn test` from the project root.",
    walkthrough: [
      "Scaffold or open a Java API solution (New project → API → Java).",
      "From the workbench, click Build test.",
      "Step 1: define the endpoint constant + URL entry as usual.",
      "Step 2: define the helper method, parameters, build target, and test class.",
      "Submit — memento writes all four files atomically across both Maven modules.",
      "Run `mvn test` from the project root (Maven discovers both modules from the parent pom).",
    ],
    fields: [
      { name: "Layout written", description: "Parent `pom.xml`; `{sln}-automation-api` module (`src/main/java/com/{pkg}/automation/api/{constants,infrastructure,handlers,extensions}/...`); `{sln}-automation-api-tests` module with the API test collection, `apitestingassistants/`, and `tests/` packages." },
      { name: "Test fixture", description: "`ApiTestFixture` is a singleton that loads `appsettings.json` from the test classpath and lazily creates one `java.net.http.HttpClient` per `urlName`." },
      { name: "Runner", description: "`mvn test` from the project root." },
      { name: "Codegen module", description: "`artifacts/api-server/src/features/codegen/infrastructure/apiJavaCodegen.ts` (registered in `apiTestCodegenRegistry`)." },
    ],
  },
];

import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-api-build-test-nodejs",
    heading: "Workbench — Build Test (Node.js)",
    intro:
      "The Build Test dialog opened on a Node.js API solution. Same two-step wizard as the other languages; the four files it writes target the Node.js layout (single npm package, kebab-case file names, Vitest as the runner). Generated tests are `<kebab>.spec.ts` files run with `npx vitest run`.",
    walkthrough: [
      "Scaffold or open a Node.js API solution (New project → API → Node.js).",
      "From the workbench, click Build test.",
      "Step 1: define the endpoint constant + URL entry as usual.",
      "Step 2: define the helper method, parameters, build target, and test class.",
      "Submit — memento writes all four files atomically.",
      "Run `npx vitest run` from the project root.",
    ],
    fields: [
      { name: "Layout written", description: "`src/automation-api/{constants,infrastructure,handlers,extensions}/*.ts` (kebab-case) + `tests/{appsettings.json, infrastructure/api-test-collection.ts, api-testing-assistants/, tests/<kebab>.spec.ts}`." },
      { name: "Helper class file", description: "`<class-name>-api-testing-assistants.ts` — the helper class whose method the generated test calls." },
      { name: "Runner", description: "`npx vitest run` from the project root." },
      { name: "Codegen module", description: "`artifacts/api-server/src/features/codegen/infrastructure/apiNodejsCodegen.ts` (registered in `apiTestCodegenRegistry`)." },
    ],
  },
];

import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "home-new-project-api-language",
    heading: "Home — New project: API language picker",
    intro:
      "When you click New project from the admin home and choose solution type API, a Language picker appears with all four supported languages: C# (.NET / NUnit), Python (pytest), Node.js (Playwright Test), and Java (JUnit 5 + Playwright). The same picker is reused for non-API (recorder / Playwright) solutions; it always governs which language scaffolder + codegen the api-server uses for this project.",
    walkthrough: [
      "On the admin home, click New project to open the dialog.",
      "Pick solution type API.",
      "Open the Language dropdown — all four options are listed.",
      "Pick a language; the rest of the dialog (solution name / namespace / etc.) stays the same.",
      "Click Create. The api-server resolves the matching scaffolder via `apiTestScaffolderRegistry` and writes the language-appropriate layout to disk.",
    ],
    fields: [
      { name: "Where it is", description: "`button-new-project` on `admin-projects-home.tsx` opens `new-project-dialog.tsx`. The Language `Select` (`select-language`) is rendered for both Playwright and API solution types." },
      { name: "Options", description: "C# (`option-language-csharp`), Python (`option-language-python`), Node.js (`option-language-nodejs`), Java (`option-language-java`). Backed by the OpenAPI `Language` enum." },
      { name: "API-specific behaviour", description: "When solution type is API, the Architecture row is hidden (the scaffolders are built-in, not architecture-driven) — see the `text-architecture-api-fixed` note in the dialog." },
      { name: "Server seam", description: "The chosen language drives `apiTestScaffolderRegistry` (under `features/projects/infrastructure/`) at create time and `apiTestCodegenRegistry` (under `features/codegen/infrastructure/`) when Build Test runs later." },
    ],
  },
];

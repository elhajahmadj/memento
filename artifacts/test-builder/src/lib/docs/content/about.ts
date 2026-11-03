import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "about",
    heading: "About this app",
    intro:
      "Background, supported recorder target languages, and links to the handoff documentation. A handy reference when on-boarding a new teammate.",
    walkthrough: [
      "Open About from the top nav.",
      "Skim the supported-languages table to see which targets the recorder ships today.",
    ],
    fields: [
      { name: "Supported languages", description: "C# (.NET / NUnit), Python (pytest), Node.js (@playwright/test), Java (JUnit 5)." },
      { name: "Documentation links", description: "Pointers to README, REQUIREMENTS, HANDOFF, CONTRIBUTING." },
    ],
  },
];

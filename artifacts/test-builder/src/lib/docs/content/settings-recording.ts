import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "settings-recording",
    heading: "Admin — Recording defaults",
    intro:
      "Tune how the recorder treats existing test code — for example, whether the recorder appends to an existing method body or replaces it on stop.",
    walkthrough: [
      "Open Admin → Recording.",
      "Adjust the toggles to match your workflow.",
      "Changes apply to subsequent recordings; in-flight recordings are unaffected.",
    ],
    fields: [
      { name: "Replace vs append", description: "Decide what happens when a recording stops on top of existing code." },
      { name: "Hook backups", description: "When a recording overwrites a setup hook, the previous body is backed up to disk; choose how many backups to keep per hook." },
    ],
  },
];

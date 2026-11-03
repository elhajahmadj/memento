import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "settings-appearance",
    heading: "Settings — Appearance",
    intro:
      "Choose how Test Builder looks. The Theme picker switches between Dark, Light, and Grey palettes; the Navigation layout picker chooses whether the primary navigation lives in a top bar (the default) or a left-hand side rail. Both choices are saved to your account, so they follow you across browsers and devices the next time you sign in. Available to every signed-in role.",
    walkthrough: [
      "Open Settings → Appearance.",
      "Under Theme, pick Dark, Light, or Grey.",
      "Under Navigation layout, pick Top bar (the default) or Side nav. The change takes effect immediately and is remembered for your account on every browser and device.",
    ],
    fields: [
      { name: "Theme", description: "Dark, Light, or Grey palette." },
      {
        name: "Navigation layout — Top bar",
        description:
          "Default. Primary navigation runs across the top of every page.",
      },
      {
        name: "Navigation layout — Side nav",
        description:
          "Primary navigation lives in a left-hand side rail instead of the top bar. Identical destinations, just relocated.",
      },
      {
        name: "Persistence",
        description:
          "Both Theme and Navigation layout are stored as per-user preferences on the server, so the choice follows you across browsers and devices rather than living in a single browser's local storage. The default for new accounts is Top bar.",
      },
    ],
  },
];

import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "tools-ai-assists",
    heading: "Tools — AI assists",
    intro:
      "AI assists are small, single-purpose buttons that ask the configured AI provider to do one thing — translate a sentence into a test step, suggest test cases for a URL, explain a failure, or draft a project doc page. Every assist shares the same key from Tools → AI Agent, the same per-project enable switch, the same encrypted-at-rest provider credentials, and the same client-side error handling. Available to every role that can see the project; gated server-side by the project's AI Agent enable switch.",
    walkthrough: [
      "Make sure an admin has set up Tools → AI Agent for the org and enabled the project — without that, every assist returns a friendly \"AI is disabled\" message and no upstream call is made.",
      "Click any \"AI\" / sparkle button in the app (Workbench → Add step from text, Add assertion from text, Suggest test cases from URL, Explain failure, Summarize suite, Generate doc page).",
      "If the upstream provider errors (rate-limit, invalid key, etc.), the assist shows the provider's status code and lets you retry — your work is not lost.",
      "If the model returns something the assist can't parse, you'll see \"AI output did not match expected shape — try again\". Re-running usually succeeds.",
    ],
    fields: [
      {
        name: "Translate plain-English step",
        description:
          "Turn a sentence like \"Click the Sign In button\" into a structured test action (verb, selector, optional value, plain-English explanation).",
      },
      {
        name: "Translate plain-English assertion",
        description:
          "Turn an expectation like \"I should see the Welcome banner\" into a structured assertion (kind, target selector, expected value).",
      },
      {
        name: "Suggest test cases from URL",
        description:
          "Given a landing URL, propose 3-7 candidate end-to-end test cases (happy paths, common error paths, one accessibility / visual smoke) with suggested steps.",
      },
      {
        name: "Explain failure in plain English",
        description:
          "Take a Playwright / API / assertion error message and produce 1-3 sentences a non-engineer can read, plus one concrete next-action suggestion.",
      },
      {
        name: "Summarize this suite",
        description:
          "Short Markdown summary of what the project's tests cover, key user flows, and what they don't cover — suitable for handing off to a new teammate.",
      },
      {
        name: "Generate project doc page",
        description:
          "One-page Markdown doc titled \"What this app does and what we test\" — what the app appears to do, what the suite covers, login flow, known flaky areas, recent failures.",
      },
      {
        name: "Error handling",
        description:
          "All six assists share four normalized error codes: disabled (no key / org or project off), provider (upstream LLM error — surfaces the provider's HTTP status), bad_output (model returned unparseable JSON), over_cap (org's monthly token cap exceeded). Network errors fall back to a generic toast.",
      },
    ],
  },
];

import { z } from "zod/v4";
import type { LlmChatMessage } from "./llmProviderTypes";
import type { AiAssistPurpose } from "./aiAssistKit";

/**
 * Registry of every "AI assist" surface in the app. Each entry is a
 * self-contained prompt + output schema. Adding a new surface is a
 * single new entry here plus a UI button that hits
 * `POST /api/ai-agent/assists/<id>` with the matching input shape.
 *
 * Naming convention for the IDs uses kebab-case so the URL slug
 * matches the registry key directly.
 */

export type AiAssistPurposeId =
  | "step-from-text"
  | "assertion-from-text"
  | "test-ideas-from-url"
  | "failure-reason"
  | "suite-summary"
  | "doc-page";

const JSON_ONLY_SUFFIX =
  "Return ONLY a single JSON value with the requested shape. " +
  "Do not wrap in prose, do not include markdown fences.";

// ---------------------------------------------------------------------
// 1. Plain-English step authoring
// ---------------------------------------------------------------------

const stepInput = z.object({
  text: z.string().min(1).max(500),
  pageUrl: z.string().max(2000).optional(),
  recentSteps: z.array(z.string().max(200)).max(20).optional(),
});

const stepOutput = z.object({
  verb: z.enum([
    "navigate",
    "click",
    "fill",
    "press",
    "wait",
    "hover",
    "select",
  ]),
  selector: z.string().min(1).max(500),
  value: z.string().max(500).optional(),
  explanation: z.string().max(280),
});

const stepFromText: AiAssistPurpose<
  z.infer<typeof stepInput>,
  z.infer<typeof stepOutput>
> = {
  id: "step-from-text",
  label: "Translate plain-English step",
  input: stepInput,
  output: stepOutput,
  maxTokens: 400,
  buildMessages(i): LlmChatMessage[] {
    return [
      {
        role: "system",
        content: [
          "You translate a single plain-English sentence into a structured",
          "browser-test action. Output JSON shape:",
          '  { "verb": "click"|"fill"|"navigate"|"press"|"wait"|"hover"|"select",',
          '    "selector": "<css or text= selector>",',
          '    "value": "<optional, for fill/select/press>",',
          '    "explanation": "<one-line plain English>" }',
          "Selector guidance:",
          "  - Prefer `getByRole`-style text= selectors when the user names a visible label.",
          "  - Use CSS only when the user specifies an id, class, or attribute.",
          '  - For navigate, use the URL as the selector (e.g. "https://example.com").',
          JSON_ONLY_SUFFIX,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          i.pageUrl ? `Current page: ${i.pageUrl}` : null,
          i.recentSteps && i.recentSteps.length > 0
            ? `Recent steps:\n${i.recentSteps.map((s) => `- ${s}`).join("\n")}`
            : null,
          `Sentence: ${i.text}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ];
  },
};

// ---------------------------------------------------------------------
// 2. Plain-English assertion authoring
// ---------------------------------------------------------------------

const assertionInput = z.object({
  text: z.string().min(1).max(500),
  pageUrl: z.string().max(2000).optional(),
});

const assertionOutput = z.object({
  kind: z.enum([
    "text-contains",
    "url-equals",
    "url-contains",
    "element-visible",
    "element-hidden",
    "accessibility",
    "visual-baseline",
  ]),
  target: z.string().min(1).max(500),
  expected: z.string().max(500).optional(),
  explanation: z.string().max(280),
});

const assertionFromText: AiAssistPurpose<
  z.infer<typeof assertionInput>,
  z.infer<typeof assertionOutput>
> = {
  id: "assertion-from-text",
  label: "Translate plain-English assertion",
  input: assertionInput,
  output: assertionOutput,
  maxTokens: 400,
  buildMessages(i): LlmChatMessage[] {
    return [
      {
        role: "system",
        content: [
          "You translate a single plain-English expectation into a",
          "structured browser-test assertion. Output JSON shape:",
          '  { "kind": "text-contains"|"url-equals"|"url-contains"',
          '          |"element-visible"|"element-hidden"',
          '          |"accessibility"|"visual-baseline",',
          '    "target": "<selector or url>",',
          '    "expected": "<optional expected text/value>",',
          '    "explanation": "<one-line plain English>" }',
          "Mapping guidance:",
          '  - "I expect to see X" → element-visible, target = best selector for X.',
          '  - "The page should say X" / "I should see the text X" → text-contains.',
          '  - "Should be on /foo" / "URL is X" → url-equals or url-contains.',
          '  - "It should be accessible" → accessibility (target = main).',
          '  - "Looks the same as before" → visual-baseline (target = page).',
          JSON_ONLY_SUFFIX,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          i.pageUrl ? `Current page: ${i.pageUrl}` : null,
          `Sentence: ${i.text}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ];
  },
};

// ---------------------------------------------------------------------
// 3. AI test-case ideas from a URL
// ---------------------------------------------------------------------

const ideasInput = z.object({
  url: z.string().min(1).max(2000),
  productHint: z.string().max(500).optional(),
});

const ideasOutput = z.object({
  ideas: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        oneLineDescription: z.string().min(1).max(280),
        suggestedSteps: z.array(z.string().min(1).max(200)).min(1).max(12),
      }),
    )
    .min(1)
    .max(8),
});

const testIdeasFromUrl: AiAssistPurpose<
  z.infer<typeof ideasInput>,
  z.infer<typeof ideasOutput>
> = {
  id: "test-ideas-from-url",
  label: "Suggest test cases from URL",
  input: ideasInput,
  output: ideasOutput,
  maxTokens: 1200,
  buildMessages(i): LlmChatMessage[] {
    return [
      {
        role: "system",
        content: [
          "You propose 3-7 candidate end-to-end test cases for a web",
          "application given its landing URL. Cover happy paths,",
          "common error paths (already-taken email, wrong password,",
          "validation errors), and one accessibility / visual smoke",
          "test where appropriate.",
          "Output JSON shape:",
          '  { "ideas": [{ "name": "Sign-up happy path",',
          '                "oneLineDescription": "...",',
          '                "suggestedSteps": ["Navigate to /signup", ...] }] }',
          JSON_ONLY_SUFFIX,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `URL: ${i.url}`,
          i.productHint ? `Product hint: ${i.productHint}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ];
  },
};

// ---------------------------------------------------------------------
// 4. Failure-reason translator
// ---------------------------------------------------------------------

const failureInput = z.object({
  stepDescription: z.string().min(1).max(500),
  errorMessage: z.string().min(1).max(4000),
  failedSelector: z.string().max(500).optional(),
  pageUrl: z.string().max(2000).optional(),
});

const failureOutput = z.object({
  plainEnglishReason: z.string().min(1).max(600),
  suggestedNextAction: z.string().min(1).max(400),
});

const failureReason: AiAssistPurpose<
  z.infer<typeof failureInput>,
  z.infer<typeof failureOutput>
> = {
  id: "failure-reason",
  label: "Explain test failure in plain English",
  input: failureInput,
  output: failureOutput,
  maxTokens: 500,
  buildMessages(i): LlmChatMessage[] {
    return [
      {
        role: "system",
        content: [
          "You translate a Playwright / API / assertion error message",
          "into 1-3 sentences a non-engineer (PM, QA lead) can",
          "understand, plus a single concrete next-action suggestion.",
          "Output JSON shape:",
          '  { "plainEnglishReason": "...",',
          '    "suggestedNextAction": "..." }',
          "Examples of next actions: \"Wait longer — the page seems slow\",",
          '"The button text changed from \\"Submit\\" to \\"Send\\" — update the assertion",',
          '"The server returned 503 — re-run when the service is up".',
          JSON_ONLY_SUFFIX,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Step: ${i.stepDescription}`,
          i.failedSelector ? `Failed selector: ${i.failedSelector}` : null,
          i.pageUrl ? `Page: ${i.pageUrl}` : null,
          `Error:\n${i.errorMessage}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ];
  },
};

// ---------------------------------------------------------------------
// 5. AI suite summary
// ---------------------------------------------------------------------

const summaryInput = z.object({
  projectName: z.string().min(1).max(200),
  testNames: z.array(z.string().max(200)).max(200),
  sampleSteps: z.array(z.string().max(300)).max(80).optional(),
});

const summaryOutput = z.object({
  summaryMarkdown: z.string().min(1).max(4000),
});

const suiteSummary: AiAssistPurpose<
  z.infer<typeof summaryInput>,
  z.infer<typeof summaryOutput>
> = {
  id: "suite-summary",
  label: "Explain this suite in plain English",
  input: summaryInput,
  output: summaryOutput,
  maxTokens: 1000,
  buildMessages(i): LlmChatMessage[] {
    return [
      {
        role: "system",
        content: [
          "You write a short plain-English summary of what a test suite",
          "covers, suitable for handing off to a new teammate or a",
          "stakeholder. Use Markdown. Include these sections (skip any",
          "that don't apply):",
          "  ## What this suite covers",
          "  ## Key user flows",
          "  ## Things this suite does NOT cover",
          "Keep the whole document under 400 words.",
          "Output JSON shape:",
          '  { "summaryMarkdown": "..." }',
          JSON_ONLY_SUFFIX,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Project: ${i.projectName}`,
          `Tests (${i.testNames.length}):`,
          ...i.testNames.slice(0, 200).map((t) => `- ${t}`),
          i.sampleSteps && i.sampleSteps.length > 0
            ? `\nSample steps:\n${i.sampleSteps.slice(0, 80).map((s) => `- ${s}`).join("\n")}`
            : "",
        ].join("\n"),
      },
    ];
  },
};

// ---------------------------------------------------------------------
// 6. AI-authored documentation page
// ---------------------------------------------------------------------

const docInput = z.object({
  projectName: z.string().min(1).max(200),
  testNames: z.array(z.string().max(200)).max(200),
  recentFailures: z.array(z.string().max(400)).max(20).optional(),
});

const docOutput = z.object({
  markdown: z.string().min(1).max(8000),
});

const docPage: AiAssistPurpose<
  z.infer<typeof docInput>,
  z.infer<typeof docOutput>
> = {
  id: "doc-page",
  label: "Generate project documentation page",
  input: docInput,
  output: docOutput,
  maxTokens: 1800,
  buildMessages(i): LlmChatMessage[] {
    return [
      {
        role: "system",
        content: [
          "You write a one-page Markdown doc titled",
          '"What this app does and what we test". Sections:',
          "  # <Project>",
          "  ## What the app appears to do",
          "  ## What this suite tests",
          "  ## How we log in (if applicable)",
          "  ## Known flaky areas",
          "  ## Recent failures",
          "Keep it under 800 words. Output JSON shape:",
          '  { "markdown": "..." }',
          JSON_ONLY_SUFFIX,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Project: ${i.projectName}`,
          `Tests:`,
          ...i.testNames.slice(0, 200).map((t) => `- ${t}`),
          i.recentFailures && i.recentFailures.length > 0
            ? `\nRecent failures:\n${i.recentFailures.map((s) => `- ${s}`).join("\n")}`
            : "",
        ].join("\n"),
      },
    ];
  },
};

// ---------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: Record<AiAssistPurposeId, AiAssistPurpose<any, any>> = {
  "step-from-text": stepFromText,
  "assertion-from-text": assertionFromText,
  "test-ideas-from-url": testIdeasFromUrl,
  "failure-reason": failureReason,
  "suite-summary": suiteSummary,
  "doc-page": docPage,
};

export function getAiAssistPurpose(
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): AiAssistPurpose<any, any> | null {
  return (REGISTRY as Record<string, AiAssistPurpose<unknown, unknown>>)[id] ??
    null;
}

export function listAiAssistPurposeIds(): AiAssistPurposeId[] {
  return Object.keys(REGISTRY) as AiAssistPurposeId[];
}

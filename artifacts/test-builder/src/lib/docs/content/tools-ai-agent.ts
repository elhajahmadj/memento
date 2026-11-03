import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "tools-ai-agent",
    heading: "Tools — AI Agent",
    intro:
      "Admin-only. Configure the AI test-authoring agent for the workspace: enable it organization-wide, choose one of eight providers (Anthropic, OpenAI, Google Gemini, OpenRouter, Azure OpenAI, Groq, DeepSeek, Mistral), store an API key (encrypted at rest), optionally override the model, opt individual projects in or out, and curate the per-project hint catalog the agent uses when interpreting plans.",
    walkthrough: [
      "Open Tools → AI Agent.",
      "Toggle Enable for organization on.",
      "Pick a provider — the Model field pre-fills the provider's recommended default (e.g. gemini-2.5-flash for Gemini, llama-3.3-70b-versatile for Groq). Override the model only if you know you want a specific one.",
      "For Azure OpenAI, also fill the Endpoint URL (e.g. https://my-resource.openai.azure.com) and API version (default 2024-10-21); the Model field on Azure carries your deployment name, not a model id. For OpenRouter you may optionally fill HTTP-Referer and X-Title attribution headers.",
      "Paste the API key, click Verify key (lightweight upstream auth ping), then Save. Only the last four characters of the saved key are ever shown.",
      "Use the per-project switches to opt projects in.",
      "Pick a project under Project catalog and add reusable methods, stable selectors, or category labels the agent should reuse when authoring tests.",
    ],
    fields: [
      { name: "Enable for organization", description: "Master switch. When off, the per-project switches and the workbench Test with AI button have no effect." },
      { name: "Provider", description: "Pick one of Anthropic (Claude), OpenAI, Google Gemini, OpenRouter, Azure OpenAI, Groq, DeepSeek, or Mistral." },
      { name: "API key / Verify key", description: "Paste the upstream key and verify before saving. Verify hits the provider's lightest auth-only endpoint (e.g. /v1/models). Saved keys are encrypted at rest with PROJECT_SECRETS_KEY; only the last four characters are ever shown." },
      { name: "Model", description: "Free-form model id, pre-filled with the provider default. For Azure OpenAI this is the deployment name (required)." },
      { name: "Endpoint URL / API version (Azure only)", description: "Resource endpoint and REST API version for Azure OpenAI. API version defaults to 2024-10-21 when blank." },
      { name: "HTTP-Referer / X-Title (OpenRouter only)", description: "Optional attribution headers OpenRouter passes to the underlying provider." },
      { name: "Per-project toggles", description: "One switch per available project. The Test with AI button only appears when both org-level and project-level switches are on and a key is configured." },
      { name: "Catalog (Methods / Selectors / Categories)", description: "User-curated hints. Rows added automatically by the agent during a run are tagged ai." },
    ],
  },
];

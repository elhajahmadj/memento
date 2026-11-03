import type { ProviderDefinition } from "./types";

export const openaiProvider: ProviderDefinition = {
  value: "openai",
  label: "OpenAI",
  shortLabel: "OpenAI",
  defaultModel: "gpt-4o-mini",
  ConditionalFields: null,
};

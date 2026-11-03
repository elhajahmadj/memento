import type { ProviderDefinition } from "./types";

export const groqProvider: ProviderDefinition = {
  value: "groq",
  label: "Groq",
  shortLabel: "Groq",
  defaultModel: "llama-3.3-70b-versatile",
  ConditionalFields: null,
};

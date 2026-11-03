import type { ProviderDefinition } from "./types";

export const anthropicProvider: ProviderDefinition = {
  value: "anthropic",
  label: "Anthropic (Claude)",
  shortLabel: "Anthropic",
  defaultModel: "claude-3-5-haiku-latest",
  ConditionalFields: null,
};

import type { AiProvider } from "../types";
import { anthropicProvider } from "./anthropic";
import { azureOpenAiProvider } from "./azure-openai";
import { deepseekProvider } from "./deepseek";
import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import { mistralProvider } from "./mistral";
import { openaiProvider } from "./openai";
import { openrouterProvider } from "./openrouter";
import type { ProviderDefinition } from "./types";

export type {
  ConditionalFieldsProps,
  ConditionalFieldsValue,
  ProviderDefinition,
} from "./types";

export const PROVIDER_DEFINITIONS: Record<AiProvider, ProviderDefinition> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  openrouter: openrouterProvider,
  azure_openai: azureOpenAiProvider,
  groq: groqProvider,
  deepseek: deepseekProvider,
  mistral: mistralProvider,
};

const ORDERED: ProviderDefinition[] = [
  anthropicProvider,
  openaiProvider,
  geminiProvider,
  openrouterProvider,
  azureOpenAiProvider,
  groqProvider,
  deepseekProvider,
  mistralProvider,
];

export const PROVIDER_OPTIONS: ReadonlyArray<{
  value: AiProvider;
  label: string;
}> = ORDERED.map((p) => ({ value: p.value, label: p.label }));

export const DEFAULT_MODELS: Record<AiProvider, string> = Object.fromEntries(
  ORDERED.map((p) => [p.value, p.defaultModel]),
) as Record<AiProvider, string>;

export const PROVIDER_LABEL: Record<AiProvider, string> = Object.fromEntries(
  ORDERED.map((p) => [p.value, p.label]),
) as Record<AiProvider, string>;

export const PROVIDER_SHORT_LABEL: Record<AiProvider, string> =
  Object.fromEntries(ORDERED.map((p) => [p.value, p.shortLabel])) as Record<
    AiProvider,
    string
  >;

import {
  bearerListModelsVerify,
  openAiCompatibleChat,
} from "./_shared";
import type { ServerProviderDefinition } from "./types";

export const openaiProvider: ServerProviderDefinition = {
  value: "openai",
  label: "OpenAI",
  defaultModel: "gpt-4o-mini",
  acceptedExtras: [],
  verify({ apiKey }) {
    return bearerListModelsVerify({
      def: openaiProvider,
      url: "https://api.openai.com/v1/models",
      apiKey,
    });
  },
  chat({ apiKey, model, messages, maxTokens, temperature }) {
    return openAiCompatibleChat({
      def: openaiProvider,
      url: "https://api.openai.com/v1/chat/completions",
      apiKey,
      model,
      messages,
      maxTokens,
      temperature,
    });
  },
};

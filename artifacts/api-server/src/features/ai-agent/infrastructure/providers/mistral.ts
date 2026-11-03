import {
  bearerListModelsVerify,
  openAiCompatibleChat,
} from "./_shared";
import type { ServerProviderDefinition } from "./types";

export const mistralProvider: ServerProviderDefinition = {
  value: "mistral",
  label: "Mistral",
  defaultModel: "mistral-small-latest",
  acceptedExtras: [],
  verify({ apiKey }) {
    return bearerListModelsVerify({
      def: mistralProvider,
      url: "https://api.mistral.ai/v1/models",
      apiKey,
    });
  },
  chat({ apiKey, model, messages, maxTokens, temperature }) {
    return openAiCompatibleChat({
      def: mistralProvider,
      url: "https://api.mistral.ai/v1/chat/completions",
      apiKey,
      model,
      messages,
      maxTokens,
      temperature,
    });
  },
};

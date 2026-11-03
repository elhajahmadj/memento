import {
  bearerListModelsVerify,
  openAiCompatibleChat,
} from "./_shared";
import type { ServerProviderDefinition } from "./types";

export const deepseekProvider: ServerProviderDefinition = {
  value: "deepseek",
  label: "DeepSeek",
  defaultModel: "deepseek-chat",
  acceptedExtras: [],
  verify({ apiKey }) {
    return bearerListModelsVerify({
      def: deepseekProvider,
      url: "https://api.deepseek.com/models",
      apiKey,
    });
  },
  chat({ apiKey, model, messages, maxTokens, temperature }) {
    return openAiCompatibleChat({
      def: deepseekProvider,
      url: "https://api.deepseek.com/chat/completions",
      apiKey,
      model,
      messages,
      maxTokens,
      temperature,
    });
  },
};

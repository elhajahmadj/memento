import {
  bearerListModelsVerify,
  openAiCompatibleChat,
} from "./_shared";
import type { ServerProviderDefinition } from "./types";

export const openrouterProvider: ServerProviderDefinition = {
  value: "openrouter",
  label: "OpenRouter",
  defaultModel: "anthropic/claude-3.5-haiku",
  acceptedExtras: ["refererUrl", "appName"],
  verify({ apiKey }) {
    return bearerListModelsVerify({
      def: openrouterProvider,
      url: "https://openrouter.ai/api/v1/models",
      apiKey,
    });
  },
  chat({ apiKey, model, messages, maxTokens, temperature, extras }) {
    return openAiCompatibleChat({
      def: openrouterProvider,
      url: "https://openrouter.ai/api/v1/chat/completions",
      apiKey,
      model,
      messages,
      maxTokens,
      temperature,
      extraHeaders: {
        ...(extras?.refererUrl ? { "HTTP-Referer": extras.refererUrl } : {}),
        ...(extras?.appName ? { "X-Title": extras.appName } : {}),
      },
    });
  },
};

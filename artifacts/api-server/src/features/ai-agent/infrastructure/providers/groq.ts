import {
  bearerListModelsVerify,
  openAiCompatibleChat,
} from "./_shared";
import type { ServerProviderDefinition } from "./types";

export const groqProvider: ServerProviderDefinition = {
  value: "groq",
  label: "Groq",
  defaultModel: "llama-3.3-70b-versatile",
  acceptedExtras: [],
  verify({ apiKey }) {
    return bearerListModelsVerify({
      def: groqProvider,
      url: "https://api.groq.com/openai/v1/models",
      apiKey,
    });
  },
  chat({ apiKey, model, messages, maxTokens, temperature }) {
    return openAiCompatibleChat({
      def: groqProvider,
      url: "https://api.groq.com/openai/v1/chat/completions",
      apiKey,
      model,
      messages,
      maxTokens,
      temperature,
    });
  },
};

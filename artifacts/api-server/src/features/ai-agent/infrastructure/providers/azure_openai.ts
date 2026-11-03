import { AiProviderError } from "@/features/ai-agent/domain/types";
import {
  failFromResponse,
  parseOpenAiLike,
  throwOnError,
} from "./_shared";
import type { ServerProviderDefinition } from "./types";

const DEFAULT_AZURE_API_VERSION = "2024-10-21";

export const azureOpenAiProvider: ServerProviderDefinition = {
  value: "azure_openai",
  label: "Azure OpenAI",
  defaultModel: null,
  acceptedExtras: ["endpointUrl", "apiVersion"],
  requiresExplicitModel: true,
  requiresEndpointUrl: true,
  defaultApiVersion: DEFAULT_AZURE_API_VERSION,
  async verify({ apiKey, extras }) {
    const endpoint = extras?.endpointUrl?.trim();
    const apiVersion = extras?.apiVersion?.trim() || DEFAULT_AZURE_API_VERSION;
    if (!endpoint) {
      return {
        ok: false,
        provider: "azure_openai",
        errorMessage: "Azure OpenAI requires an Endpoint URL.",
      };
    }
    const url = `${endpoint.replace(/\/+$/, "")}/openai/models?api-version=${encodeURIComponent(apiVersion)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "api-key": apiKey },
    });
    if (!res.ok) return failFromResponse(azureOpenAiProvider, res);
    return { ok: true, provider: "azure_openai" };
  },
  async chat({ apiKey, extras, model, messages, maxTokens, temperature }) {
    const endpoint = extras?.endpointUrl?.trim();
    const apiVersion = extras?.apiVersion?.trim() || DEFAULT_AZURE_API_VERSION;
    if (!endpoint) {
      throw new AiProviderError(400, "Azure OpenAI is missing endpointUrl.");
    }
    const url = `${endpoint.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!res.ok) await throwOnError(azureOpenAiProvider, res);
    return parseOpenAiLike(await res.json());
  },
};

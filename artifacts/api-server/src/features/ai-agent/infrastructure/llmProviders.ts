import {
  type AiProvider,
  type AiProviderExtras,
} from "@/features/ai-agent/domain/types";
import type {
  LlmChatMessage,
  LlmChatOptions,
  LlmChatResult,
  VerifyKeyResult,
} from "./llmProviderTypes";
import { getProviderDefinition, pickModel } from "./providers";

/**
 * Thin LLM provider adapter. Two operations are exposed:
 *
 *   1. `verifyKey` — sanity-check that the API key works by hitting
 *      the provider's lightest auth-only endpoint.
 *   2. `chat` — single-turn JSON completion used by the rule-parser
 *      fallback and the AI namer.
 *
 * Both dispatch into the per-provider definitions registered in
 * `./providers`. Adding a new provider is a single new definition file
 * plus a one-line registration; this dispatcher does not switch on
 * provider name.
 */

export type {
  LlmChatMessage,
  LlmChatOptions,
  LlmChatResult,
  LlmChatUsage,
  LlmFinishReason,
  VerifyKeyResult,
} from "./llmProviderTypes";

export interface ProviderCredentials {
  provider: AiProvider;
  apiKey: string;
  extras?: Partial<AiProviderExtras>;
}

export async function verifyKey(
  creds: ProviderCredentials,
): Promise<VerifyKeyResult> {
  const { provider, apiKey, extras } = creds;
  try {
    return await getProviderDefinition(provider).verify({
      apiKey,
      extras: extras ?? {},
    });
  } catch (err) {
    return {
      ok: false,
      provider,
      errorMessage: (err as Error).message,
    };
  }
}

/**
 * Single-turn chat completion. Returns the model's text response.
 * Throws `AiProviderError` on non-2xx so callers can surface
 * 502/504-style errors to the UI.
 */
export async function chat(
  creds: ProviderCredentials,
  messages: LlmChatMessage[],
  options: LlmChatOptions = {},
): Promise<LlmChatResult> {
  const { provider, apiKey, extras } = creds;
  const model = pickModel(provider, extras, options.model);
  return getProviderDefinition(provider).chat({
    apiKey,
    extras: extras ?? {},
    model,
    messages,
    maxTokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0,
  });
}

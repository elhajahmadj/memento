import type { AiProvider } from "@/features/ai-agent/domain/types";

/**
 * Wire types for the LLM adapter. Kept in their own module so the
 * per-provider definition files under `providers/` can import them
 * without pulling in the dispatch layer (`llmProviders.ts`).
 */

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export type LlmFinishReason =
  | "stop"
  | "length"
  | "content_filter"
  | "tool_calls"
  | "other"
  | null;

export interface LlmChatUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface LlmChatResult {
  text: string;
  finishReason: LlmFinishReason;
  usage: LlmChatUsage;
}

export interface VerifyKeyResult {
  ok: boolean;
  provider: AiProvider;
  model?: string | undefined;
  errorMessage?: string | undefined;
  retryAfterSeconds?: number | undefined;
}

import { failFromResponse, snippetBody } from "./_shared";
import { AiProviderError } from "@/features/ai-agent/domain/types";
import type { LlmFinishReason } from "../llmProviderTypes";
import type { ServerProviderDefinition } from "./types";

function mapAnthropicStopReason(
  r: string | null | undefined,
): LlmFinishReason {
  switch (r) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    case null:
    case undefined:
      return null;
    default:
      return "other";
  }
}

export const anthropicProvider: ServerProviderDefinition = {
  value: "anthropic",
  label: "Anthropic",
  defaultModel: "claude-3-5-haiku-latest",
  acceptedExtras: [],
  async verify({ apiKey }) {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) return failFromResponse(anthropicProvider, res);
    return {
      ok: true,
      provider: "anthropic",
      model: anthropicProvider.defaultModel ?? undefined,
    };
  },
  async chat({ apiKey, model, messages, maxTokens, temperature }) {
    const sys = messages.find((m) => m.role === "system");
    const others = messages.filter((m) => m.role !== "system");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: sys?.content,
        messages: others.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AiProviderError(
        res.status,
        `anthropic ${res.status}: ${snippetBody(body)}`,
      );
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string | null;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text =
      data.content?.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("") ?? "";
    const prompt = data.usage?.input_tokens ?? null;
    const completion = data.usage?.output_tokens ?? null;
    return {
      text,
      finishReason: mapAnthropicStopReason(data.stop_reason ?? null),
      usage: {
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens:
          prompt !== null && completion !== null ? prompt + completion : null,
      },
    };
  },
};

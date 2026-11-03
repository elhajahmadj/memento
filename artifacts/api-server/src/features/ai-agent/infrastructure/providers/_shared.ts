import { AiProviderError } from "@/features/ai-agent/domain/types";
import type {
  LlmChatMessage,
  LlmChatResult,
  LlmFinishReason,
  VerifyKeyResult,
} from "../llmProviderTypes";
import type { ServerProviderDefinition } from "./types";

/**
 * Shared helpers used by every per-provider definition file. Kept in
 * one place so each provider stays a thin declaration: URL + auth
 * header + (for chat) the body shape, with all error handling and
 * response normalization centralized here.
 */

export function snippetBody(text: string): string {
  return text.slice(0, 500);
}

async function readErrorSnippet(res: Response): Promise<string> {
  try {
    const body = await res.text();
    return snippetBody(body.trim());
  } catch {
    return "";
  }
}

function parseRetryAfter(res: Response): number | undefined {
  const v = res.headers.get("retry-after");
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function failFromResponse(
  def: Pick<ServerProviderDefinition, "value" | "label">,
  res: Response,
): Promise<VerifyKeyResult> {
  const snippet = await readErrorSnippet(res);
  const retryAfter = parseRetryAfter(res);
  const detail = snippet ? `: ${snippet}` : "";
  const retry = retryAfter !== undefined ? ` (retry after ${retryAfter}s)` : "";
  return {
    ok: false,
    provider: def.value,
    errorMessage: `${def.label} returned HTTP ${res.status}${retry}${detail}`,
    retryAfterSeconds: retryAfter,
  };
}

export async function throwOnError(
  def: Pick<ServerProviderDefinition, "value">,
  res: Response,
): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new AiProviderError(
    res.status,
    `${def.value} ${res.status}: ${snippetBody(body)}`,
  );
}

export function mapOpenAiFinishReason(
  r: string | null | undefined,
): LlmFinishReason {
  switch (r) {
    case "stop":
    case "length":
    case "content_filter":
    case "tool_calls":
      return r;
    case null:
    case undefined:
      return null;
    default:
      return "other";
  }
}

interface OpenAiLikeBody {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export function parseOpenAiLike(data: unknown): LlmChatResult {
  const body = (data ?? {}) as OpenAiLikeBody;
  const text = body.choices?.[0]?.message?.content ?? "";
  const finish = mapOpenAiFinishReason(body.choices?.[0]?.finish_reason ?? null);
  return {
    text,
    finishReason: finish,
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? null,
      completionTokens: body.usage?.completion_tokens ?? null,
      totalTokens: body.usage?.total_tokens ?? null,
    },
  };
}

/**
 * Shared chat implementation for OpenAI-compatible providers (OpenAI,
 * OpenRouter, Groq, DeepSeek, Mistral). Each provider only needs to
 * declare its base URL and any extra headers — the body shape and
 * response normalization are identical.
 */
export async function openAiCompatibleChat(opts: {
  def: ServerProviderDefinition;
  url: string;
  apiKey: string;
  model: string;
  messages: LlmChatMessage[];
  maxTokens: number;
  temperature: number;
  extraHeaders?: Record<string, string>;
}): Promise<LlmChatResult> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "content-type": "application/json",
      ...(opts.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      messages: opts.messages,
    }),
  });
  if (!res.ok) await throwOnError(opts.def, res);
  return parseOpenAiLike(await res.json());
}

/**
 * Shared verify implementation for providers that expose a Bearer-auth
 * `/models` listing endpoint. Hits the URL, returns ok on 2xx,
 * surfaces the upstream status + body snippet on non-2xx.
 */
export async function bearerListModelsVerify(opts: {
  def: ServerProviderDefinition;
  url: string;
  apiKey: string;
}): Promise<VerifyKeyResult> {
  const res = await fetch(opts.url, {
    method: "GET",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
  });
  if (!res.ok) return failFromResponse(opts.def, res);
  return {
    ok: true,
    provider: opts.def.value,
    model: opts.def.defaultModel ?? undefined,
  };
}

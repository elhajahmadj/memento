import { z, type ZodType } from "zod/v4";
import { logger } from "@/shared/logger";
import {
  assertAgentReady,
  type DecryptedProviderCreds,
} from "./aiAgentService";
import { chat, type LlmChatMessage, type LlmChatResult } from "./llmProviders";
import {
  AiAgentDisabledError,
  AiProviderError,
} from "@/features/ai-agent/domain/types";
import type { AiAssistPurposeId } from "./aiAssistPurposes";

/**
 * Shared kit every "AI assist" surface in the app routes through.
 *
 * Each assist is described by a Purpose: a prompt template + an output
 * Zod schema. `runAiAssist` resolves the project's active key,
 * builds the messages, calls `chat()`, extracts JSON, parses it
 * against the schema, and returns a typed result.
 *
 * Failure modes are normalized into `AiAssistError` so every route /
 * client hook can render a consistent toast + "no key" message:
 *   - `disabled`   — org or project disabled, or no key configured
 *   - `provider`   — upstream LLM 4xx/5xx (key invalid, rate limit, etc.)
 *   - `bad_output` — model returned no parseable JSON / failed schema
 *   - `over_cap`   — org's monthly token soft-cap exceeded
 */

export type AiAssistErrorCode =
  | "disabled"
  | "provider"
  | "bad_output"
  | "over_cap";

export class AiAssistError extends Error {
  readonly code: AiAssistErrorCode;
  readonly httpStatus: number;
  readonly providerStatus?: number;
  readonly disabledReason?: "ORG_DISABLED" | "PROJECT_DISABLED" | "NO_API_KEY";
  constructor(
    code: AiAssistErrorCode,
    message: string,
    opts: {
      httpStatus?: number;
      providerStatus?: number;
      disabledReason?: "ORG_DISABLED" | "PROJECT_DISABLED" | "NO_API_KEY";
    } = {},
  ) {
    super(message);
    this.name = "AiAssistError";
    this.code = code;
    this.httpStatus = opts.httpStatus ?? defaultStatus(code);
    if (opts.providerStatus !== undefined) {
      this.providerStatus = opts.providerStatus;
    }
    if (opts.disabledReason !== undefined) {
      this.disabledReason = opts.disabledReason;
    }
  }
}

function defaultStatus(code: AiAssistErrorCode): number {
  switch (code) {
    case "disabled":
      return 503;
    case "provider":
      return 502;
    case "bad_output":
      return 502;
    case "over_cap":
      return 429;
  }
}

export interface AiAssistResult<T> {
  output: T;
  model: string | null;
  usage: LlmChatResult["usage"];
  purpose: AiAssistPurposeId;
}

export interface AiAssistPurpose<TInput, TOutput> {
  id: AiAssistPurposeId;
  /** Human-readable label, surfaced in the audit log + tooltip. */
  label: string;
  /** Zod schema applied to the request body. */
  input: ZodType<TInput>;
  /** Zod schema the model's JSON output must conform to. */
  output: ZodType<TOutput>;
  /** Build the chat messages for this purpose. */
  buildMessages(input: TInput): LlmChatMessage[];
  /** Optional token cap override (default 800). */
  maxTokens?: number;
  /**
   * Optional output transformer — runs after JSON parse but before
   * schema validation. Useful when the model wraps the answer.
   */
  preParse?(raw: unknown): unknown;
}

/**
 * Core driver. Every AI assist endpoint calls this with the resolved
 * Purpose + parsed input. Throws `AiAssistError` on any non-OK
 * outcome; the route layer maps that to an HTTP response.
 */
export async function runAiAssist<TInput, TOutput>(opts: {
  purpose: AiAssistPurpose<TInput, TOutput>;
  input: TInput;
  organizationId: string | null;
  projectName: string;
  userId: string;
}): Promise<AiAssistResult<TOutput>> {
  let creds: DecryptedProviderCreds;
  try {
    creds = await assertAgentReady({
      organizationId: opts.organizationId,
      projectName: opts.projectName,
    });
  } catch (err) {
    if (err instanceof AiAgentDisabledError) {
      throw new AiAssistError("disabled", err.message, {
        disabledReason: err.code,
      });
    }
    throw err;
  }

  let completion: LlmChatResult;
  try {
    completion = await chat(
      {
        provider: creds.provider,
        apiKey: creds.apiKey,
        extras: creds.extras,
      },
      opts.purpose.buildMessages(opts.input),
      { maxTokens: opts.purpose.maxTokens ?? 800 },
    );
  } catch (err) {
    if (err instanceof AiProviderError) {
      throw new AiAssistError("provider", err.message, {
        providerStatus: err.status,
      });
    }
    throw new AiAssistError("provider", (err as Error).message);
  }

  const json = tryExtractJson(completion.text);
  if (json === undefined) {
    throw new AiAssistError(
      "bad_output",
      "AI returned no parseable JSON. Try again or rephrase your input.",
    );
  }
  const transformed = opts.purpose.preParse ? opts.purpose.preParse(json) : json;
  const parsed = opts.purpose.output.safeParse(transformed);
  if (!parsed.success) {
    throw new AiAssistError(
      "bad_output",
      `AI output did not match expected shape: ${parsed.error.message}`,
    );
  }

  logger.info(
    {
      kind: "ai_assist",
      purpose: opts.purpose.id,
      projectName: opts.projectName,
      organizationId: opts.organizationId,
      userId: opts.userId,
      provider: creds.provider,
      model: creds.extras.model,
      promptTokens: completion.usage.promptTokens,
      completionTokens: completion.usage.completionTokens,
      totalTokens: completion.usage.totalTokens,
      finishReason: completion.finishReason,
    },
    "AI assist completed",
  );

  return {
    output: parsed.data,
    model: creds.extras.model ?? null,
    usage: completion.usage,
    purpose: opts.purpose.id,
  };
}

/**
 * Pull the first JSON value out of `text`. Tries strict parse first,
 * then falls back to extracting the first `{…}` or `[…]` block — many
 * models wrap their JSON in ```json fences or a one-line preamble.
 */
export function tryExtractJson(text: string): unknown | undefined {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  const obj = trimmed.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      return JSON.parse(obj[0]);
    } catch {
      /* fall through */
    }
  }
  const arr = trimmed.match(/\[[\s\S]*\]/);
  if (arr) {
    try {
      return JSON.parse(arr[0]);
    } catch {
      /* fall through */
    }
  }
  return undefined;
}

// Re-export z for purpose authors so they don't have to add an import.
export { z };

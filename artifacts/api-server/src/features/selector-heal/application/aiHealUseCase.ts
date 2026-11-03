import { logger } from "@/shared/logger";
import {
  type AppError,
  err,
  infrastructureError,
  notFoundError,
  ok,
  type Result,
  unknownError,
  validationError,
} from "@workspace/kernel";
import { assertAgentReady } from "@/features/ai-agent/infrastructure/aiAgentService";
import {
  AiAgentDisabledError,
  AiProviderError,
} from "@/features/ai-agent/domain/types";
import { chat } from "@/features/ai-agent/infrastructure/llmProviders";

export interface AiHealContext {
  actionDescription?: string | null;
  errorMessage?: string | null;
  pageUrl?: string | null;
  domSnippet?: string | null;
  priorSteps?: string[];
}

export interface AiHealInput {
  organizationId: string | null;
  projectName: string;
  oldSelector: string;
  context: AiHealContext;
}

export interface AiHealSuggestion {
  suggestedSelector: string;
  confidence: "high" | "medium" | "low";
  explanation: string;
  model: string | null;
  provider: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

const SYSTEM = [
  "You are a senior QA engineer helping repair a broken Playwright/CSS selector.",
  "Given the failing step's context, return ONLY a JSON object with this exact shape:",
  '{ "suggestedSelector": "<one selector string, no surrounding quotes>",',
  '  "confidence": "high" | "medium" | "low",',
  '  "explanation": "<one or two short plain-English sentences for a non-coder>" }',
  "Rules:",
  "- Prefer stable selectors in this order: data-testid, role + accessible name, label text, then CSS.",
  "- Never invent selectors that aren't suggested by the context.",
  "- If the page DOM snippet is missing, propose a sensible variant of the old selector",
  "  (e.g. swap a brittle nth-child for a data-testid or role).",
  "- Do not include surrounding markdown, code fences, or prose outside the JSON object.",
].join("\n");

function buildUserPrompt(input: AiHealInput): string {
  const c = input.context;
  const parts: string[] = [];
  parts.push(`Old selector that no longer works: ${input.oldSelector}`);
  if (c.actionDescription) parts.push(`Action that failed: ${c.actionDescription}`);
  if (c.errorMessage) parts.push(`Error message from the browser:\n${c.errorMessage}`);
  if (c.pageUrl) parts.push(`Page URL: ${c.pageUrl}`);
  if (c.priorSteps && c.priorSteps.length > 0) {
    parts.push(
      `Surrounding steps (most recent last):\n${c.priorSteps
        .slice(-8)
        .map((s, i) => `  ${i + 1}. ${s}`)
        .join("\n")}`,
    );
  }
  if (c.domSnippet) {
    parts.push(`DOM snippet near the previous match site:\n${c.domSnippet.slice(0, 2000)}`);
  }
  parts.push("Return only the JSON object described in the system message.");
  return parts.join("\n\n");
}

interface ParsedSuggestion {
  suggestedSelector: string;
  confidence: "high" | "medium" | "low";
  explanation: string;
}

function parseSuggestion(text: string): ParsedSuggestion | null {
  // Strip optional ```json fences and grab the first {...} block so a
  // chatty model that wraps its JSON still parses cleanly.
  const cleaned = text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const slice = cleaned.slice(start, end + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const sel = typeof obj.suggestedSelector === "string" ? obj.suggestedSelector.trim() : "";
  const expl =
    typeof obj.explanation === "string" ? obj.explanation.trim() : "";
  const confRaw =
    typeof obj.confidence === "string" ? obj.confidence.toLowerCase().trim() : "";
  const confidence: ParsedSuggestion["confidence"] =
    confRaw === "high" || confRaw === "medium" || confRaw === "low"
      ? confRaw
      : "medium";
  if (!sel || !expl) return null;
  return { suggestedSelector: sel, confidence, explanation: expl };
}

/**
 * Ask the configured AI provider for a replacement selector. Returns
 * `Result<AiHealSuggestion, AppError>` so the route can translate the
 * error `.kind` into the right HTTP status via `httpStatusForAppError`.
 *
 * Errors:
 *   - `not_found`        — no AI key configured for org/project.
 *   - `validation`       — provider rejected the request (e.g. 400).
 *   - `infrastructure`   — provider 5xx / network / unparseable response.
 *   - `unknown`          — unexpected throw.
 */
export async function suggestSelectorFix(
  input: AiHealInput,
): Promise<Result<AiHealSuggestion, AppError>> {
  let creds;
  try {
    creds = await assertAgentReady({
      organizationId: input.organizationId,
      projectName: input.projectName,
    });
  } catch (e) {
    if (e instanceof AiAgentDisabledError) {
      return err(
        notFoundError(
          "ai_agent",
          e.code,
          e.message,
        ),
      );
    }
    return err(unknownError("Failed to resolve AI key", e));
  }

  const start = Date.now();
  let result;
  try {
    result = await chat(
      {
        provider: creds.provider,
        apiKey: creds.apiKey,
        extras: creds.extras,
      },
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildUserPrompt(input) },
      ],
      { maxTokens: 400, temperature: 0 },
    );
  } catch (e) {
    const ms = Date.now() - start;
    if (e instanceof AiProviderError) {
      logger.warn(
        {
          event: "ai_selector_heal",
          outcome: "provider_error",
          provider: creds.provider,
          status: e.status,
          ms,
        },
        "AI selector heal: provider returned an error",
      );
      if (e.status === 401 || e.status === 403) {
        return err(
          validationError(
            "The configured AI key was rejected by the provider. An admin can fix this in Tools → AI Agent.",
          ),
        );
      }
      if (e.status === 429) {
        return err(
          infrastructureError(
            "The AI provider is rate-limited right now. Please try again in a moment, or use Re-pick / Advanced.",
          ),
        );
      }
      return err(
        infrastructureError(
          `The AI provider failed (HTTP ${e.status}). Please try Re-pick or Advanced.`,
        ),
      );
    }
    logger.warn(
      { event: "ai_selector_heal", outcome: "network_error", provider: creds.provider, ms, err: e },
      "AI selector heal: network/transport error",
    );
    return err(
      infrastructureError(
        "Couldn't reach the AI provider. Please try Re-pick or Advanced.",
        e,
      ),
    );
  }

  const ms = Date.now() - start;
  const parsed = parseSuggestion(result.text);
  if (!parsed) {
    logger.warn(
      {
        event: "ai_selector_heal",
        outcome: "unparseable",
        provider: creds.provider,
        model: creds.extras.model ?? null,
        ms,
        tokensIn: result.usage.promptTokens,
        tokensOut: result.usage.completionTokens,
      },
      "AI selector heal: response did not match expected JSON shape",
    );
    return err(
      infrastructureError(
        "The AI's response didn't make sense. Please try again, or use Re-pick / Advanced.",
      ),
    );
  }
  if (parsed.suggestedSelector === input.oldSelector) {
    return err(
      validationError(
        "The AI suggested the same selector that's already broken. Please try Re-pick or Advanced.",
      ),
    );
  }

  logger.info(
    {
      event: "ai_selector_heal",
      outcome: "ok",
      provider: creds.provider,
      model: creds.extras.model ?? null,
      ms,
      tokensIn: result.usage.promptTokens,
      tokensOut: result.usage.completionTokens,
      confidence: parsed.confidence,
    },
    "AI selector heal: suggestion produced",
  );

  return ok({
    suggestedSelector: parsed.suggestedSelector,
    confidence: parsed.confidence,
    explanation: parsed.explanation,
    model: creds.extras.model ?? null,
    provider: creds.provider,
    tokensIn: result.usage.promptTokens,
    tokensOut: result.usage.completionTokens,
  });
}

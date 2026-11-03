import { failFromResponse, throwOnError } from "./_shared";
import type { LlmFinishReason } from "../llmProviderTypes";
import type { ServerProviderDefinition } from "./types";

function mapGeminiFinishReason(
  r: string | null | undefined,
): LlmFinishReason {
  switch (r) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "content_filter";
    case null:
    case undefined:
      return null;
    default:
      return "other";
  }
}

export const geminiProvider: ServerProviderDefinition = {
  value: "gemini",
  label: "Gemini",
  defaultModel: "gemini-2.5-flash",
  acceptedExtras: [],
  async verify({ apiKey }) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { method: "GET" },
    );
    if (!res.ok) return failFromResponse(geminiProvider, res);
    return {
      ok: true,
      provider: "gemini",
      model: geminiProvider.defaultModel ?? undefined,
    };
  },
  async chat({ apiKey, model, messages, maxTokens, temperature }) {
    const sysParts = messages
      .filter((m) => m.role === "system")
      .map((m) => ({ text: m.content }));
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents,
        ...(sysParts.length > 0
          ? { systemInstruction: { role: "system", parts: sysParts } }
          : {}),
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    });
    if (!res.ok) await throwOnError(geminiProvider, res);
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return {
      text,
      finishReason: mapGeminiFinishReason(
        data.candidates?.[0]?.finishReason ?? null,
      ),
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount ?? null,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? null,
        totalTokens: data.usageMetadata?.totalTokenCount ?? null,
      },
    };
  },
};

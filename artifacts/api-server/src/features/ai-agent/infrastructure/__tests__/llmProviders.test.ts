import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { verifyKey, chat } from "../llmProviders";
import {
  AiProviderError,
  type AiProvider,
} from "@/features/ai-agent/domain/types";
import { AI_PROVIDERS } from "@/features/ai-agent/infrastructure/providers";

/**
 * Coverage for the multi-provider LLM adapter shipped with task #71.
 * The adapter is a thin wrapper around `fetch` against eight upstream
 * APIs — we stub `globalThis.fetch` so the tests are deterministic and
 * never touch the network.
 *
 * The matrix below pins the per-provider invariants that matter:
 *  - which URL each adapter hits,
 *  - which auth header / query parameter carries the API key,
 *  - how the response body is unwrapped into `{ text }`,
 *  - and that bad-key 401s surface as `AiProviderError` (chat) or
 *    `{ ok:false }` (verifyKey).
 */

interface FetchCall {
  url: string;
  init?: RequestInit | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("llmProviders.verifyKey", () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    calls.length = 0;
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const cases: Array<{
    provider: AiProvider;
    expectUrlSubstr: string;
    extras?: Partial<{
      endpointUrl: string;
      apiVersion: string;
      refererUrl: string;
      appName: string;
      model: string;
    }>;
  }> = [
    { provider: "anthropic", expectUrlSubstr: "api.anthropic.com/v1/models" },
    { provider: "openai", expectUrlSubstr: "api.openai.com/v1/models" },
    {
      provider: "gemini",
      expectUrlSubstr: "generativelanguage.googleapis.com/v1beta/models?key=",
    },
    { provider: "openrouter", expectUrlSubstr: "openrouter.ai/api/v1/models" },
    {
      provider: "azure_openai",
      expectUrlSubstr: "my-resource.openai.azure.com/openai/models?api-version=2024-10-21",
      extras: { endpointUrl: "https://my-resource.openai.azure.com" },
    },
    { provider: "groq", expectUrlSubstr: "api.groq.com/openai/v1/models" },
    { provider: "deepseek", expectUrlSubstr: "api.deepseek.com/models" },
    { provider: "mistral", expectUrlSubstr: "api.mistral.ai/v1/models" },
  ];

  it("covers every supported provider", () => {
    expect(cases.map((c) => c.provider).sort()).toEqual([...AI_PROVIDERS].sort());
  });

  for (const c of cases) {
    it(`hits the right URL for ${c.provider}`, async () => {
      const r = await verifyKey({
        provider: c.provider,
        apiKey: "test-key-1234",
        extras: {
          endpointUrl: c.extras?.endpointUrl ?? null,
          apiVersion: c.extras?.apiVersion ?? null,
          refererUrl: null,
          appName: null,
          model: null,
        },
      });
      expect(r.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toContain(c.expectUrlSubstr);
    });
  }

  it("returns ok:false when Azure OpenAI is missing endpointUrl", async () => {
    const r = await verifyKey({
      provider: "azure_openai",
      apiKey: "k",
      extras: {
        endpointUrl: null,
        apiVersion: null,
        refererUrl: null,
        appName: null,
        model: null,
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toMatch(/Endpoint URL/);
  });

  it("surfaces upstream 401 with a body snippet", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('{"error":{"message":"Invalid bearer key"}}', {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;
    const r = await verifyKey({ provider: "openai", apiKey: "bad" });
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toMatch(/401/);
    expect(r.errorMessage).toMatch(/Invalid bearer key/);
    expect(r.retryAfterSeconds).toBeUndefined();
  });

  it("propagates Retry-After on a 429", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('{"error":"rate limit"}', {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "37" },
      }),
    ) as typeof fetch;
    const r = await verifyKey({ provider: "anthropic", apiKey: "k" });
    expect(r.ok).toBe(false);
    expect(r.retryAfterSeconds).toBe(37);
    expect(r.errorMessage).toMatch(/retry after 37s/);
  });
});

describe("llmProviders.chat", () => {
  let lastCall: FetchCall | null = null;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    lastCall = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubProvider(provider: AiProvider, responseBody: unknown) {
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      lastCall = { url: String(input), init };
      return jsonResponse(responseBody);
    }) as unknown as typeof fetch;
    return provider;
  }

  it("anthropic — extracts content[].text + normalizes stop_reason + usage", async () => {
    stubProvider("anthropic", {
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 11, output_tokens: 7 },
    });
    const r = await chat(
      { provider: "anthropic", apiKey: "k" },
      [{ role: "user", content: "hi" }],
    );
    expect(r.text).toBe("hello");
    expect(r.finishReason).toBe("stop");
    expect(r.usage).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
    expect(lastCall!.url).toContain("api.anthropic.com/v1/messages");
    expect((lastCall!.init!.headers as Record<string, string>)["x-api-key"]).toBe("k");
  });

  it("gemini — extracts parts[].text + maps MAX_TOKENS + usage", async () => {
    stubProvider("gemini", {
      candidates: [
        {
          content: { parts: [{ text: "g-hi" }] },
          finishReason: "MAX_TOKENS",
        },
      ],
      usageMetadata: {
        promptTokenCount: 4,
        candidatesTokenCount: 9,
        totalTokenCount: 13,
      },
    });
    const r = await chat(
      { provider: "gemini", apiKey: "g-key" },
      [{ role: "user", content: "hi" }],
    );
    expect(r.text).toBe("g-hi");
    expect(r.finishReason).toBe("length");
    expect(r.usage).toEqual({
      promptTokens: 4,
      completionTokens: 9,
      totalTokens: 13,
    });
    expect(lastCall!.url).toContain(":generateContent?key=g-key");
  });

  it("azure_openai — hits deployment path with api-version", async () => {
    stubProvider("azure_openai", {
      choices: [{ message: { content: "azure-hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    });
    const r = await chat(
      {
        provider: "azure_openai",
        apiKey: "az",
        extras: {
          endpointUrl: "https://r.openai.azure.com",
          apiVersion: "2024-10-21",
          refererUrl: null,
          appName: null,
          model: "my-deployment",
        },
      },
      [{ role: "user", content: "hi" }],
    );
    expect(r.text).toBe("azure-hi");
    expect(r.finishReason).toBe("stop");
    expect(r.usage.totalTokens).toBe(8);
    expect(lastCall!.url).toBe(
      "https://r.openai.azure.com/openai/deployments/my-deployment/chat/completions?api-version=2024-10-21",
    );
    expect((lastCall!.init!.headers as Record<string, string>)["api-key"]).toBe("az");
  });

  it("openrouter — forwards HTTP-Referer and X-Title when provided", async () => {
    stubProvider("openrouter", {
      choices: [{ message: { content: "or-hi" } }],
    });
    await chat(
      {
        provider: "openrouter",
        apiKey: "or",
        extras: {
          endpointUrl: null,
          apiVersion: null,
          refererUrl: "https://site.example",
          appName: "memento",
          model: null,
        },
      },
      [{ role: "user", content: "hi" }],
    );
    const h = lastCall!.init!.headers as Record<string, string>;
    expect(h["HTTP-Referer"]).toBe("https://site.example");
    expect(h["X-Title"]).toBe("memento");
  });

  it.each(["openai", "groq", "deepseek", "mistral"] as const)(
    "%s — Bearer auth + /chat/completions + normalized finishReason/usage",
    async (provider) => {
      stubProvider(provider, {
        choices: [{ message: { content: "x" }, finish_reason: "length" }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      });
      const r = await chat(
        { provider, apiKey: "key" },
        [{ role: "user", content: "hi" }],
      );
      expect(r.text).toBe("x");
      expect(r.finishReason).toBe("length");
      expect(r.usage).toEqual({
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      });
      expect(lastCall!.url).toContain("/chat/completions");
      expect((lastCall!.init!.headers as Record<string, string>).Authorization).toBe("Bearer key");
    },
  );

  it("normalizes unknown OpenAI finish_reason to 'other' and missing usage to nulls", async () => {
    stubProvider("openai", {
      choices: [{ message: { content: "x" }, finish_reason: "weird_reason" }],
    });
    const r = await chat(
      { provider: "openai", apiKey: "k" },
      [{ role: "user", content: "hi" }],
    );
    expect(r.finishReason).toBe("other");
    expect(r.usage).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  });

  it("maps Gemini SAFETY finishReason to content_filter", async () => {
    stubProvider("gemini", {
      candidates: [
        {
          content: { parts: [{ text: "" }] },
          finishReason: "SAFETY",
        },
      ],
    });
    const r = await chat(
      { provider: "gemini", apiKey: "k" },
      [{ role: "user", content: "hi" }],
    );
    expect(r.finishReason).toBe("content_filter");
  });

  it("non-2xx upstream throws AiProviderError", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("nope", { status: 401 }),
    ) as typeof fetch;
    await expect(
      chat(
        { provider: "openai", apiKey: "bad" },
        [{ role: "user", content: "hi" }],
      ),
    ).rejects.toBeInstanceOf(AiProviderError);
  });

  it("azure without endpointUrl throws 400 AiProviderError", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "" } }] }),
    ) as typeof fetch;
    await expect(
      chat(
        {
          provider: "azure_openai",
          apiKey: "az",
          extras: {
            endpointUrl: null,
            apiVersion: null,
            refererUrl: null,
            appName: null,
            model: "dep",
          },
        },
        [{ role: "user", content: "hi" }],
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

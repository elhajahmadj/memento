import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { toast } from "sonner";
import { useAiAssist } from "@/shared/ai-assist/use-ai-assist";

/**
 * Tests for the shared `useAiAssist` client hook used by every AI
 * assist surface in the app. The hook owns the request shape and
 * the mapping from the server's normalized error codes
 * (`disabled` / `provider` / `bad_output` / `over_cap`) to the
 * `AiAssistError` the calling components render.
 */

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = ORIGINAL_FETCH;
});

function mockFetchOnce(init: { status: number; body: unknown }): void {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(init.body), {
        status: init.status,
        headers: { "content-type": "application/json" },
      }),
  ) as typeof fetch;
}

describe("useAiAssist — happy path", () => {
  it("POSTs to the right URL and returns the parsed result", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            output: { verb: "click", selector: "text=Go", explanation: "x" },
            model: "claude",
            usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
            purpose: "step-from-text",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useAiAssist<{ text: string }, { verb: string; selector: string }>({
        purpose: "step-from-text",
      }),
    );
    let returned: unknown;
    await act(async () => {
      returned = await result.current.run({ text: "Click Go" });
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/ai-agent/assists/step-from-text",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ text: "Click Go" }),
      }),
    );
    expect((returned as { purpose: string }).purpose).toBe("step-from-text");
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.lastResult?.model).toBe("claude");
  });
});

describe("useAiAssist — error mapping", () => {
  it("surfaces 503 disabled with disabledReason and toasts", async () => {
    mockFetchOnce({
      status: 503,
      body: {
        error: "no key",
        code: "disabled",
        disabledReason: "NO_API_KEY",
      },
    });
    const { result } = renderHook(() =>
      useAiAssist({ purpose: "step-from-text" }),
    );
    await act(async () => {
      await result.current.run({ text: "x" });
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.code).toBe("disabled");
    expect(result.current.error?.disabledReason).toBe("NO_API_KEY");
    expect(toast.error).toHaveBeenCalledWith("no key");
  });

  it("surfaces 502 provider with providerStatus", async () => {
    mockFetchOnce({
      status: 502,
      body: { error: "upstream 429", code: "provider", providerStatus: 429 },
    });
    const { result } = renderHook(() =>
      useAiAssist({ purpose: "step-from-text" }),
    );
    await act(async () => {
      await result.current.run({ text: "x" });
    });
    await waitFor(() => expect(result.current.error?.code).toBe("provider"));
    expect(result.current.error?.providerStatus).toBe(429);
  });

  it("surfaces 502 bad_output", async () => {
    mockFetchOnce({
      status: 502,
      body: { error: "AI returned no parseable JSON.", code: "bad_output" },
    });
    const { result } = renderHook(() =>
      useAiAssist({ purpose: "step-from-text" }),
    );
    await act(async () => {
      await result.current.run({ text: "x" });
    });
    await waitFor(() => expect(result.current.error?.code).toBe("bad_output"));
  });

  it("suppresses toast when toastOnError=false", async () => {
    mockFetchOnce({
      status: 503,
      body: { error: "disabled", code: "disabled" },
    });
    const { result } = renderHook(() =>
      useAiAssist({ purpose: "step-from-text", toastOnError: false }),
    );
    await act(async () => {
      await result.current.run({ text: "x" });
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("maps network errors to code 'unknown'", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useAiAssist({ purpose: "step-from-text" }),
    );
    await act(async () => {
      await result.current.run({ text: "x" });
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.code).toBe("unknown");
    expect(result.current.error?.message).toBe("offline");
  });

  it("reset() clears the error and last result", async () => {
    mockFetchOnce({
      status: 503,
      body: { error: "x", code: "disabled" },
    });
    const { result } = renderHook(() =>
      useAiAssist({ purpose: "step-from-text" }),
    );
    await act(async () => {
      await result.current.run({ text: "x" });
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
    expect(result.current.lastResult).toBeNull();
  });
});

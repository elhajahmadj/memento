import { useCallback, useState } from "react";
import { toast } from "sonner";

/**
 * Shared client kit for every "AI assist" surface. One mutation hook
 * + one button component. Calls `POST /api/ai-agent/assists/:purpose`
 * and normalizes the four error shapes the server can return:
 *   - 503 + code "disabled"   — org/project disabled or no key
 *   - 502 + code "provider"   — upstream LLM failure
 *   - 502 + code "bad_output" — model returned unparseable output
 *   - 429 + code "over_cap"   — monthly token cap exceeded
 *
 * Plus 401 (unauthorized), 400 (invalid input), 404 (unknown
 * purpose), 500 (unexpected) which are surfaced as plain toasts.
 */

export type AiAssistErrorCode =
  | "disabled"
  | "provider"
  | "bad_output"
  | "over_cap"
  | "unknown";

export interface AiAssistError {
  code: AiAssistErrorCode;
  message: string;
  httpStatus: number;
  disabledReason?: "ORG_DISABLED" | "PROJECT_DISABLED" | "NO_API_KEY";
  providerStatus?: number;
}

export interface AiAssistResult<T> {
  output: T;
  model: string | null;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
  purpose: string;
}

export interface UseAiAssistReturn<TInput, TOutput> {
  run: (input: TInput) => Promise<AiAssistResult<TOutput> | null>;
  busy: boolean;
  error: AiAssistError | null;
  lastResult: AiAssistResult<TOutput> | null;
  reset: () => void;
}

export function useAiAssist<TInput, TOutput>(opts: {
  purpose: string;
  /**
   * When true, the hook surfaces failures via `sonner` toasts. The
   * caller can opt out (e.g. when rendering a richer inline error UI)
   * by setting this to false. Defaults to true.
   */
  toastOnError?: boolean;
}): UseAiAssistReturn<TInput, TOutput> {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AiAssistError | null>(null);
  const [lastResult, setLastResult] = useState<AiAssistResult<TOutput> | null>(
    null,
  );
  const toastOnError = opts.toastOnError !== false;

  const run = useCallback(
    async (input: TInput): Promise<AiAssistResult<TOutput> | null> => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch(
          `/api/ai-agent/assists/${encodeURIComponent(opts.purpose)}`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as {
            error?: string;
            code?: AiAssistErrorCode;
            disabledReason?: AiAssistError["disabledReason"];
            providerStatus?: number;
          };
          const err: AiAssistError = {
            code: body.code ?? "unknown",
            message: body.error ?? `Request failed (HTTP ${r.status})`,
            httpStatus: r.status,
            ...(body.disabledReason
              ? { disabledReason: body.disabledReason }
              : {}),
            ...(body.providerStatus !== undefined
              ? { providerStatus: body.providerStatus }
              : {}),
          };
          setError(err);
          if (toastOnError) toast.error(err.message);
          return null;
        }
        const data = (await r.json()) as AiAssistResult<TOutput>;
        setLastResult(data);
        return data;
      } catch (e) {
        const err: AiAssistError = {
          code: "unknown",
          message: (e as Error).message ?? "Network error",
          httpStatus: 0,
        };
        setError(err);
        if (toastOnError) toast.error(err.message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [opts.purpose, toastOnError],
  );

  const reset = useCallback(() => {
    setError(null);
    setLastResult(null);
  }, []);

  return { run, busy, error, lastResult, reset };
}

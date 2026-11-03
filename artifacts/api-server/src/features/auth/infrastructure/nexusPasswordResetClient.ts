/**
 * Adapter for Nexus's public password-reset endpoint
 * (`POST /api/auth/forgot-password`). The endpoint takes `{ email }`,
 * no auth headers, and per Nexus's contract always returns 200 even
 * for unknown emails to avoid leaking which addresses exist. Memento
 * still maps unexpected statuses defensively so a future drift on the
 * Nexus side doesn't silently break the UX.
 *
 * The URL is normally derived from `NEXUS_API_BASE_URL` (matching the
 * publishing-runbook pattern used by the IDP provisioner). Operators
 * can override with `NEXUS_FORGOT_PASSWORD_URL` for an environment
 * where the reset endpoint lives on a different host.
 *
 * ## Test seam
 * The dev-only control-plane routes
 * `PUT/DELETE /api/auth/dev/nexus-forgot-password-url` let end-to-end
 * specs stand up their own Nexus stub on an ephemeral loopback port
 * and point the api-server at it for the duration of the run. To keep
 * concurrent specs isolated, each override is **keyed by an opaque
 * stub token** (an arbitrary string the spec generates per run). The
 * spec passes that token on every request — both the control-plane
 * PUT/DELETE and the user-facing `POST /api/auth/password-reset` —
 * via the `X-Nexus-Stub-Token` header. The route handler propagates
 * the token into the adapter through an `AsyncLocalStorage` context
 * so two specs running against the same api-server process never see
 * each other's overrides, and DELETE-by-token only clears that one
 * spec's entry.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "@/shared/logger";
import type {
  ForgotPasswordOutcome,
  PasswordResetClient,
} from "../domain/ports";

export type { ForgotPasswordOutcome };

export interface NexusPasswordResetClientDeps {
  /** Override the global `fetch` implementation, primarily for tests. */
  fetch?: typeof fetch;
  /** Override the resolver, primarily for tests. */
  resolveUrl?: () => string | null;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

const NOT_CONFIGURED_MESSAGE =
  "Password reset is not configured on this server. " +
  "Set NEXUS_API_BASE_URL (or NEXUS_FORGOT_PASSWORD_URL) to enable it.";

/**
 * Token-keyed runtime overrides installed by the dev-only
 * control-plane route. Two specs running in parallel against the same
 * api-server process pick distinct tokens, so neither can clobber the
 * other's entry and a `DELETE` by token only removes that one entry.
 *
 * A second "default" slot (`""`) is exposed for callers that don't
 * carry a token; it exists primarily for ad-hoc curl-style use and is
 * never set by automated specs (the e2e fixture always passes a
 * token).
 */
const forgotPasswordUrlOverrides = new Map<string, string>();

interface PasswordResetRequestContext {
  /** Token from `X-Nexus-Stub-Token` on the originating request. */
  readonly stubToken?: string;
}

const requestContext =
  new AsyncLocalStorage<PasswordResetRequestContext>();

/**
 * Run `fn` with the given request context bound to AsyncLocalStorage.
 * Used by the route handler to thread the `X-Nexus-Stub-Token` from
 * the originating request down into the adapter without polluting the
 * use-case input shape.
 */
export function runWithPasswordResetRequestContext<T>(
  ctx: PasswordResetRequestContext,
  fn: () => T,
): T {
  return requestContext.run(ctx, fn);
}

/** Test helper: current bound context, or `undefined` outside `run`. */
export function getPasswordResetRequestContext():
  | PasswordResetRequestContext
  | undefined {
  return requestContext.getStore();
}

/**
 * Install (or, with `url=null`, remove) a runtime forgot-password URL
 * override under `token`. Returns the previous value for that token
 * (or `null` if there was none). Token `""` is reserved for the
 * default slot used when no `X-Nexus-Stub-Token` is present.
 */
export function setForgotPasswordUrlOverride(
  token: string,
  url: string | null,
): string | null {
  const previous = forgotPasswordUrlOverrides.get(token) ?? null;
  if (typeof url === "string" && url.trim().length > 0) {
    forgotPasswordUrlOverrides.set(token, url.trim());
  } else {
    forgotPasswordUrlOverrides.delete(token);
  }
  return previous;
}

/** Read the override for `token`, or `null` if none is registered. */
export function getForgotPasswordUrlOverride(token: string): string | null {
  return forgotPasswordUrlOverrides.get(token) ?? null;
}

/** Test helper: count of distinct active overrides. */
export function countForgotPasswordUrlOverrides(): number {
  return forgotPasswordUrlOverrides.size;
}

/** Test helper: clear every override. Never used outside tests. */
export function clearAllForgotPasswordUrlOverrides(): void {
  forgotPasswordUrlOverrides.clear();
}

/**
 * Resolve the absolute URL of the Nexus forgot-password endpoint.
 * Precedence:
 *   1. Token-keyed runtime override matching the current request's
 *      `X-Nexus-Stub-Token` (from AsyncLocalStorage).
 *   2. Default-slot runtime override (`""`).
 *   3. `NEXUS_FORGOT_PASSWORD_URL` env override.
 *   4. `${NEXUS_API_BASE_URL}/api/auth/forgot-password`.
 * Returns `null` when Nexus isn't configured at all.
 */
export function resolveForgotPasswordUrl(): string | null {
  const ctxToken = requestContext.getStore()?.stubToken;
  if (ctxToken) {
    const keyed = forgotPasswordUrlOverrides.get(ctxToken);
    if (keyed) return keyed;
  }
  const fallback = forgotPasswordUrlOverrides.get("");
  if (fallback) return fallback;
  const override = process.env.NEXUS_FORGOT_PASSWORD_URL?.trim();
  if (override) return override;
  const base = process.env.NEXUS_API_BASE_URL?.trim();
  if (!base) return null;
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}/api/auth/forgot-password`;
}

export class NexusPasswordResetClient implements PasswordResetClient {
  private readonly fetchFn: typeof fetch;
  private readonly resolveUrl: () => string | null;
  private readonly timeoutMs: number;

  constructor(deps: NexusPasswordResetClientDeps = {}) {
    this.fetchFn = deps.fetch ?? fetch;
    this.resolveUrl = deps.resolveUrl ?? resolveForgotPasswordUrl;
    this.timeoutMs = deps.timeoutMs ?? 10_000;
  }

  async sendResetEmail(email: string): Promise<ForgotPasswordOutcome> {
    const url = this.resolveUrl();
    if (!url) {
      return { kind: "notConfigured", message: NOT_CONFIGURED_MESSAGE };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, url },
        "Identity provider password-reset request failed (network / abort)",
      );
      return {
        kind: "upstreamFailure",
        reason: `Could not reach the identity provider: ${reason}`,
      };
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 200 && response.status < 300) {
      return { kind: "ok" };
    }
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      const parsed = retryAfterHeader
        ? Number.parseInt(retryAfterHeader, 10)
        : NaN;
      const retryAfterSeconds = Number.isFinite(parsed) ? parsed : null;
      return {
        kind: "throttled",
        retryAfterSeconds,
        message:
          "The identity provider is rate-limiting password-reset requests. Please wait before retrying.",
      };
    }
    // 404 → treat as success. Nexus's contract is to always return
    // 200 even for unknown emails (so we never leak which addresses
    // exist); a 404 here would mean Nexus has drifted to "email
    // unknown" surfacing as not-found. Per the task spec we shield
    // against that drift and still return 200 `{}` to the caller so
    // the UX stays "if that email exists, you'll get a reset link".
    if (response.status === 404) {
      logger.warn(
        { url, status: 404 },
        "Identity provider password-reset returned 404; treating as success per drift-shield policy",
      );
      return { kind: "ok" };
    }
    if (response.status >= 500) {
      const reason = await readShortBody(response);
      return {
        kind: "upstreamFailure",
        reason: `Identity provider ${response.status}: ${reason}`,
      };
    }
    // 4xx other than 404 / 429 — treat as upstream failure rather
    // than 200 so a future contract drift surfaces as a clean 502.
    const reason = await readShortBody(response);
    return {
      kind: "upstreamFailure",
      reason: `Identity provider ${response.status}: ${reason}`,
    };
  }
}

async function readShortBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText || "no response body";
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * Single source of truth for "which browser origins may talk to this
 * API" — shared by the CORS middleware (audit finding C-3) and the
 * WebSocket upgrade guard (audit finding H-1) so the two can never
 * drift apart.
 *
 * Why this exists: the app previously reflected whatever `Origin` a
 * caller sent back in `Access-Control-Allow-Origin` while also sending
 * `Access-Control-Allow-Credentials: true`. That combination lets any
 * website issue authenticated cross-origin requests to this API *and
 * read the responses*. WebSocket upgrades had no `Origin` check at all,
 * which is the same problem in a protocol the same-origin policy does
 * not cover.
 *
 * Configuration: `CORS_ALLOWED_ORIGINS`, a comma-separated list of
 * absolute origins (scheme + host + optional port, no path), e.g.
 *   CORS_ALLOWED_ORIGINS=http://localhost:5173,https://memento.example
 *
 * In production the SPA is served same-origin from this very process,
 * so the honest production value is usually **empty** — same-origin
 * requests carry no `Origin` header (or one matching the host) and are
 * always allowed. The list exists mainly for local development, where
 * Vite serves the SPA on a different port.
 */

const ENV_VAR = "CORS_ALLOWED_ORIGINS";

/** Normalize to `scheme://host[:port]`, lowercased, no trailing slash. */
function normalizeOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

let cached: { raw: string | undefined; origins: Set<string> } | null = null;

/**
 * Parsed `CORS_ALLOWED_ORIGINS`. Re-parsed when the env var changes so
 * tests can set it per-case without a module reset.
 */
export function allowedOrigins(): Set<string> {
  const raw = process.env[ENV_VAR];
  if (cached && cached.raw === raw) return cached.origins;
  const origins = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const normalized = normalizeOrigin(part);
    if (normalized) origins.add(normalized);
  }
  cached = { raw, origins };
  return origins;
}

/**
 * True when a request carrying this `Origin` header may proceed.
 *
 * A missing `Origin` is allowed: same-origin navigations, `curl`, and
 * server-to-server callers omit it, and the credentialed-cross-origin
 * attack this guards against requires a browser, which always sends it
 * on cross-origin requests. An origin that equals the request's own
 * host is also allowed, which covers the production same-origin SPA
 * without needing any configuration.
 *
 * Fails closed: an origin that is present, non-empty, and not on the
 * list is rejected — never reflected.
 */
export function isOriginAllowed(
  origin: string | undefined | null,
  requestHost?: string | undefined,
): boolean {
  if (origin === undefined || origin === null || origin === "") return true;
  const normalized = normalizeOrigin(origin);
  // A malformed / opaque Origin (e.g. literal "null" from a sandboxed
  // iframe or a `file://` page) is not something we can match against
  // the allow-list, so it is rejected.
  if (!normalized) return false;
  if (allowedOrigins().has(normalized)) return true;
  if (requestHost) {
    const host = requestHost.trim().toLowerCase();
    // Same-origin: compare host:port only, since the proxy terminates
    // TLS and the inbound scheme may be http while the Origin says https.
    try {
      if (new URL(normalized).host === host) return true;
    } catch {
      /* fall through to reject */
    }
  }
  return false;
}

/** Human-readable summary for the boot log. */
export function describeAllowedOrigins(): string {
  const origins = [...allowedOrigins()];
  if (origins.length === 0) {
    return `no ${ENV_VAR} configured — only same-origin browser requests are accepted`;
  }
  return `${ENV_VAR}: ${origins.join(", ")}`;
}

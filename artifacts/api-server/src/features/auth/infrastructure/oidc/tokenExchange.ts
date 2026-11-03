import { logger } from "@/shared/logger";
import { getOidcConfig } from "../oidcConfig";
import { discover } from "./discovery";

export interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  /** Lifetime of `access_token` in seconds (RFC 6749). */
  expires_in?: number;
  token_type?: string;
}

/**
 * Exchange a stored refresh_token for a fresh access_token (and a
 * possibly-rotated refresh_token). Throws on any non-2xx response so
 * callers can distinguish recoverable failures (network) from
 * unrecoverable ones (the IDP rejected the refresh_token; user must
 * sign in again).
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const cfg = getOidcConfig();
  if (!cfg) throw new Error("OIDC is not configured");
  const doc = await discover(cfg);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OIDC refresh failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCodeForTokens(args: {
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const cfg = getOidcConfig();
  if (!cfg) throw new Error("OIDC is not configured");
  const doc = await discover(cfg);
  // Use HTTP Basic client authentication (`client_secret_basic`) rather
  // than POST-body credentials (`client_secret_post`). Both are
  // advertised by the Nexus discovery doc, but Nexus has been observed
  // to crash with an empty-body 500 on the form-post path; basic auth
  // exercises a different code path on the IDP and works around the
  // bug without changing what we authenticate as. Per RFC 6749 §2.3.1
  // the client_id and client_secret are form-encoded before being
  // base64'd into the Authorization header.
  const basicAuth = Buffer.from(
    `${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`,
  ).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: cfg.redirectUrl,
    code_verifier: args.codeVerifier,
  });
  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basicAuth}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    // Capture as much context as the IDP gives us. Nexus has been
    // observed to return 500 with an empty body — without status text
    // and headers we can't tell if it was a server crash, a
    // misconfigured client, or a code-redemption issue.
    const headerSummary: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headerSummary[k] = v;
    });
    logger.error(
      {
        status: res.status,
        statusText: res.statusText,
        headers: headerSummary,
        bodyLength: text.length,
        bodySample: text.slice(0, 500),
        tokenEndpoint: doc.token_endpoint,
        // Echo what we sent (minus the secret) so we can confirm
        // grant_type / redirect_uri / client_id match what Nexus
        // expects. PKCE verifier is not a long-term secret but we
        // still avoid logging it.
        sentParams: {
          grant_type: "authorization_code",
          redirect_uri: cfg.redirectUrl,
          client_id: cfg.clientId,
          codePresent: Boolean(args.code),
          codeVerifierPresent: Boolean(args.codeVerifier),
        },
      },
      "OIDC token exchange returned non-2xx",
    );
    throw new Error(
      `OIDC token exchange failed (${res.status} ${res.statusText}): ${text || "<empty body>"}`,
    );
  }
  return (await res.json()) as TokenResponse;
}

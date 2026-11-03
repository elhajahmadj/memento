import { type OidcConfig } from "../oidcConfig";

/** Minimal cache so we don't refetch /.well-known on every callback. */
export interface DiscoveryDoc {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string | undefined;
  end_session_endpoint?: string | undefined;
  jwks_uri: string;
  issuer: string;
}

type CachedDoc = DiscoveryDoc & { issuerUrl: string };
let discoveryCache: CachedDoc | null = null;

export async function discover(cfg: OidcConfig): Promise<CachedDoc> {
  if (discoveryCache && discoveryCache.issuerUrl === cfg.issuerUrl) {
    return discoveryCache;
  }
  const rawUrl =
    cfg.issuerUrl.replace(/\/$/, "") + "/.well-known/openid-configuration";
  // The issuer URL may be `http://` (e.g. Nexus on Fly signs an http
  // issuer into its JWTs) but the wire is HTTPS-only at the edge.
  // Upgrade the discovery fetch the same way we upgrade the endpoints
  // it returns, otherwise Fly's edge replies with an HTML 301 page
  // and the JSON parse below blows up with `Unexpected token '<'`.
  const url = upgradeToHttps(rawUrl, cfg.issuerUrl);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}) for ${url}`);
  }
  const doc = (await res.json()) as DiscoveryDoc;

  // Some IDPs (e.g. Nexus on Fly.io) advertise `http://` endpoint URLs
  // even though they only actually serve HTTPS at the edge. POSTing to
  // the http:// URL gets us an HTML 301 redirect that drops the body,
  // which then fails JSON.parse on the way back. When our configured
  // issuer is HTTPS, upgrade any same-host http:// endpoint URLs to
  // https:// so we hit TLS directly. We deliberately leave `doc.issuer`
  // untouched because that string must match the `iss` claim signed
  // into the IDP's JWTs for jose's verification to succeed.
  const upgraded: DiscoveryDoc = {
    ...doc,
    authorization_endpoint: upgradeToHttps(doc.authorization_endpoint, cfg.issuerUrl),
    token_endpoint: upgradeToHttps(doc.token_endpoint, cfg.issuerUrl),
    userinfo_endpoint: upgradeToHttps(doc.userinfo_endpoint, cfg.issuerUrl),
    end_session_endpoint: upgradeToHttps(doc.end_session_endpoint, cfg.issuerUrl),
    jwks_uri: upgradeToHttps(doc.jwks_uri, cfg.issuerUrl),
  };

  discoveryCache = { issuerUrl: cfg.issuerUrl, ...upgraded };
  return discoveryCache;
}

/**
 * Loopback / private hostnames that legitimately may not have TLS in
 * front of them (e.g. a developer running Nexus locally on
 * `http://localhost:5000`). We never silently upgrade these, because
 * doing so would break local development with no IDP-side
 * misconfiguration to blame.
 */
function isLoopbackHost(host: string): boolean {
  // `URL.host` may include a port; strip it before comparing.
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/**
 * If `endpoint` is an http:// URL whose host matches the configured
 * issuer's host, return the same URL with the scheme upgraded to
 * https. Otherwise return the URL unchanged. Returns undefined for
 * undefined inputs (optional fields).
 *
 * Why we always upgrade (regardless of the issuer's own scheme): some
 * IDPs sign an `http://` URL as the `iss` claim (Nexus on Fly does
 * this) but only actually serve HTTPS at the edge. Hitting the http
 * URL gets back an HTML 301 redirect, which then breaks `res.json()`.
 * The `iss` claim itself is verified against the configured issuer
 * string elsewhere — we never rewrite that — so flipping the
 * transport scheme here is safe.
 *
 * The single exception is loopback addresses: a developer running an
 * IDP locally on `http://localhost:5000` very likely does NOT have
 * TLS, and silently upgrading would break their setup.
 */
export function upgradeToHttps(endpoint: string, issuerUrl: string): string;
export function upgradeToHttps(
  endpoint: string | undefined,
  issuerUrl: string,
): string | undefined;
export function upgradeToHttps(
  endpoint: string | undefined,
  issuerUrl: string,
): string | undefined {
  if (!endpoint) return endpoint;
  let endpointUrl: URL;
  let issuer: URL;
  try {
    endpointUrl = new URL(endpoint);
    issuer = new URL(issuerUrl);
  } catch {
    return endpoint;
  }
  if (
    endpointUrl.protocol === "http:" &&
    endpointUrl.host === issuer.host &&
    !isLoopbackHost(endpointUrl.host)
  ) {
    endpointUrl.protocol = "https:";
    return endpointUrl.toString();
  }
  return endpoint;
}

/** Test-only helper: clear the discovery cache between cases. */
export function _resetDiscoveryCacheForTests(): void {
  discoveryCache = null;
}

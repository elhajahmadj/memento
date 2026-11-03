import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";
import { getOidcConfig } from "../oidcConfig";
import { discover } from "./discovery";

/**
 * Token-verifier port. The bearer-auth middleware depends on this
 * shape rather than the concrete JOSE-backed function, so tests (and
 * future non-Nexus verifiers) can swap in their own implementation.
 */
export interface TokenVerifier {
  verifyIdToken(jwt: string): Promise<Record<string, unknown>>;
  verifyAccessToken(jwt: string): Promise<Record<string, unknown>>;
}

/**
 * Per-issuer JWKS cache. `createRemoteJWKSet` itself caches keys with a
 * sane TTL and supports key rotation, so we just memoize the function.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Verify the OIDC ID token's signature against the provider's JWKS and
 * validate `iss` and `aud`. Replaces the previous unverified decode so
 * we don't trust identity claims from a token whose signature/origin we
 * never checked.
 *
 * Returns the verified claim set. Throws if signature, issuer, or
 * audience validation fails.
 */
export async function verifyIdToken(jwt: string): Promise<Record<string, unknown>> {
  const cfg = getOidcConfig();
  if (!cfg) throw new Error("OIDC is not configured");
  const doc = await discover(cfg);
  let jwks = jwksCache.get(doc.jwks_uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
    jwksCache.set(doc.jwks_uri, jwks);
  }
  const { payload } = await jwtVerify(jwt, jwks, {
    issuer: doc.issuer,
    audience: cfg.clientId,
  });
  return payload as Record<string, unknown>;
}

/**
 * Verify a Nexus-issued OAuth2 *access token* presented in an
 * `Authorization: Bearer <token>` header on `/api/*` requests.
 *
 * Same JWKS path as `verifyIdToken` — discovery + JWKS are cached, the
 * issuer is taken from the discovery document, and the audience is
 * pinned to our OIDC client id so a token issued for some other client
 * in the same tenant can't authenticate as us. Throws if signature,
 * issuer, audience, or `exp` validation fails; callers (the bearer
 * middleware) must translate that into a `401`.
 */
export async function verifyAccessToken(
  jwt: string,
): Promise<Record<string, unknown>> {
  const cfg = getOidcConfig();
  if (!cfg) throw new Error("OIDC is not configured");
  const doc = await discover(cfg);
  let jwks = jwksCache.get(doc.jwks_uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
    jwksCache.set(doc.jwks_uri, jwks);
  }
  const { payload } = await jwtVerify(jwt, jwks, {
    issuer: doc.issuer,
    audience: cfg.clientId,
  });
  return payload as Record<string, unknown>;
}

/**
 * Default token verifier wired to the JOSE-backed JWKS path above.
 * Imported by the bearer middleware unless a test overrides it.
 */
export const defaultTokenVerifier: TokenVerifier = {
  verifyIdToken,
  verifyAccessToken,
};

/**
 * Unsafe convenience used only by tests / debug paths to peek at a JWT's
 * claims without verifying its signature. Production code paths must use
 * `verifyIdToken` instead.
 */
export function decodeJwtClaimsUnsafe(jwt: string): Record<string, unknown> {
  return decodeJwt(jwt) as Record<string, unknown>;
}

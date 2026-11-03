/**
 * Token-verifier port. The bearer-auth middleware and the SSO callback
 * depend on this shape rather than the concrete JOSE-backed function so
 * tests (and future non-Nexus verifiers) can swap in their own
 * implementation. Verified claim sets are returned as plain records.
 */
export interface OidcTokenVerifier {
  verifyIdToken(jwt: string): Promise<Record<string, unknown>>;
  verifyAccessToken(jwt: string): Promise<Record<string, unknown>>;
}

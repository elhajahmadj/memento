/**
 * IDP I/O port. Groups the network calls the auth use cases need to
 * make against the OIDC provider (code exchange, userinfo, refresh).
 * The token-shape is intentionally the same as the existing
 * `TokenResponse` in `infrastructure/oidc/tokenExchange.ts` so adapters
 * can pass values through unchanged.
 */
export interface OidcTokens {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  /** Lifetime of `access_token` in seconds (RFC 6749). */
  expires_in?: number;
  token_type?: string;
}

export interface OidcGateway {
  exchangeCodeForTokens(args: {
    code: string;
    codeVerifier: string;
  }): Promise<OidcTokens>;

  refreshAccessToken(refreshToken: string): Promise<OidcTokens>;

  /** Fetch the live `/userinfo` payload for a given access token. */
  fetchUserInfo(accessToken: string): Promise<Record<string, unknown>>;
}

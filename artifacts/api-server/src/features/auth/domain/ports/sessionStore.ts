/**
 * Mutable, framework-agnostic view of the per-request session payload
 * that the auth use cases touch. Keep this in sync (additively) with
 * the express-session declarations in `infrastructure/adapters/
 * expressSessionStore.ts`.
 */
export interface AuthSessionData {
  userId?: string | null;
  activeOrgId?: string | null;
  oidcState?: string;
  oidcCodeVerifier?: string;
  oidcIdToken?: string;
  oidcAccessToken?: string;
  oidcRefreshToken?: string;
  oidcAccessTokenExpiresAt?: number;
}

/**
 * Per-request session port. Adapters wrap the underlying transport
 * session store (express-session today). All mutators are awaitable so
 * adapters can flush changes before returning.
 */
export interface SessionStore {
  /** Live, mutable view of the session payload. */
  readonly data: AuthSessionData;

  /** Issue a fresh session id (anti session-fixation on sign-in). */
  regenerate(): Promise<void>;

  /** Persist the current session payload. */
  save(): Promise<void>;

  /** Destroy the session entirely (sign-out). */
  destroy(): Promise<void>;
}

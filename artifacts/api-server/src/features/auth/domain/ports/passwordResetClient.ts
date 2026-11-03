/**
 * IDP password-reset port. The auth feature uses this to ask the
 * configured Identity Provider (Nexus today) to email the signed-in
 * user a password-reset link. Memento never sees the new password —
 * the IDP owns the reset UI.
 *
 * Outcome is a discriminated union rather than `Result<T, AppError>`
 * because the route handler needs to distinguish HTTP 429 / 502 / 503
 * cleanly, none of which map onto a single AppError kind today.
 */
export type ForgotPasswordOutcome =
  | { kind: "ok" }
  | {
      kind: "throttled";
      retryAfterSeconds: number | null;
      message: string;
    }
  | { kind: "upstreamFailure"; reason: string }
  | { kind: "notConfigured"; message: string };

export interface PasswordResetClient {
  sendResetEmail(email: string): Promise<ForgotPasswordOutcome>;
}

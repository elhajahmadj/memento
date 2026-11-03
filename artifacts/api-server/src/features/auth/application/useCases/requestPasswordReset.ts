/**
 * Use case: ask the configured IDP (Nexus) to email the signed-in user
 * a password-reset link. Memento never sees the new password — Nexus
 * owns the reset UI.
 *
 * - Local username/password users get a `conflict` error: the action
 *   isn't available for them because they have no Nexus account.
 * - The use case applies a per-user throttle (one call every 60s) so a
 *   buggy client can't spam Nexus.
 * - The adapter outcome (`ok` / `throttled` / `upstreamFailure` /
 *   `notConfigured`) is forwarded back to the route handler verbatim so
 *   the presentation layer can map each branch to the right HTTP status
 *   (200 / 429 / 502 / 503).
 */
import type { User } from "@workspace/db";
import { isLocalUser } from "../../domain/effectiveRole";
import type {
  ForgotPasswordOutcome,
  PasswordResetClient,
} from "../../domain/ports";

export type RequestPasswordResetOutcome =
  | { kind: "ok" }
  | { kind: "localUser" }
  | { kind: "throttledSelf"; retryAfterSeconds: number }
  | {
      kind: "throttledUpstream";
      retryAfterSeconds: number | null;
      message: string;
    }
  | { kind: "upstreamFailure"; reason: string }
  | { kind: "notConfigured"; message: string }
  | { kind: "missingEmail" };

export interface RequestPasswordResetInput {
  /** The signed-in user (must carry an email; SSO users always do). */
  readonly user: Pick<User, "id" | "email" | "authSource">;
}

export interface PasswordResetThrottle {
  /**
   * Return the number of seconds remaining on the throttle for
   * `userId`, or `0` if the caller is allowed to proceed. Implementations
   * must record the call as soon as they return `0` so concurrent
   * requests can't slip past.
   */
  consume(userId: string): number;
}

/**
 * Simple in-memory throttle keyed by user id. The auth feature only
 * has one process today, so this is enough; the use case never relies
 * on cross-process state.
 */
export class InMemoryPasswordResetThrottle implements PasswordResetThrottle {
  private readonly lastCallAt = new Map<string, number>();
  constructor(
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = Date.now,
  ) {}
  consume(userId: string): number {
    const now = this.now();
    const last = this.lastCallAt.get(userId) ?? 0;
    const elapsed = now - last;
    if (elapsed < this.windowMs) {
      return Math.ceil((this.windowMs - elapsed) / 1000);
    }
    this.lastCallAt.set(userId, now);
    return 0;
  }
}

export class RequestPasswordResetUseCase {
  constructor(
    private readonly client: PasswordResetClient,
    private readonly throttle: PasswordResetThrottle,
  ) {}

  async execute(
    input: RequestPasswordResetInput,
  ): Promise<RequestPasswordResetOutcome> {
    if (isLocalUser(input.user)) {
      return { kind: "localUser" };
    }
    const email = (input.user.email ?? "").trim();
    if (!email) {
      return { kind: "missingEmail" };
    }
    const wait = this.throttle.consume(input.user.id);
    if (wait > 0) {
      return { kind: "throttledSelf", retryAfterSeconds: wait };
    }
    const outcome: ForgotPasswordOutcome =
      await this.client.sendResetEmail(email);
    switch (outcome.kind) {
      case "ok":
        return { kind: "ok" };
      case "throttled":
        return {
          kind: "throttledUpstream",
          retryAfterSeconds: outcome.retryAfterSeconds,
          message: outcome.message,
        };
      case "upstreamFailure":
        return { kind: "upstreamFailure", reason: outcome.reason };
      case "notConfigured":
        return { kind: "notConfigured", message: outcome.message };
    }
  }
}

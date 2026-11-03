/**
 * Shared types for the sso-denials feature.
 *
 * Extracted out of `ssoDenialService.ts` so the notifier (which only
 * needs the `SsoDenialGate` discriminator) can reference it without
 * forming a cycle (`ssoDenialService` → `ssoDenialNotifier` →
 * `ssoDenialService`). Also home to `PublicSsoDenial`, the route-facing
 * shape used by routes/notifier alike.
 */
export type SsoDenialGate =
  | "no_memento_user"
  | "no_memento_access"
  | "no_org";

export interface PublicSsoDenial {
  id: string;
  subject: string;
  email: string | null;
  gate: SsoDenialGate;
  orgKey: string | null;
  createdAt: string;
  handledAt: string | null;
  handledByUsername: string | null;
}

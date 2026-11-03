import type { Organization, User } from "@workspace/db";
import type { NormalizedClaims } from "../claims";

export interface ProfileUpdate {
  firstName: string;
  lastName: string;
  title: string;
  email: string;
}

/**
 * Persistence port for everything the auth feature needs to know about
 * users (and the organizations they belong to). Adapters live in
 * `infrastructure/adapters/`.
 */
export interface UserRepository {
  /** Look up a user by primary key (session/bearer reuse). */
  findById(id: string): Promise<User | null>;

  /** Username lookup used by the local sign-in flow. */
  findByUsername(username: string): Promise<User | null>;

  /** Apply a profile update from the "complete your profile" form. */
  updateProfile(id: string, update: ProfileUpdate): Promise<User | null>;

  /** Read the (already-synced) orgs for an IDP user. Empty for local users. */
  listOrgsForUser(userId: string): Promise<Organization[]>;

  /**
   * Idempotently upsert orgs + the user, then re-sync `user_organizations`
   * to exactly match the normalized claim set. Used by both SSO callback
   * and bearer-token sign-in paths.
   */
  provisionFromClaims(
    claims: NormalizedClaims,
  ): Promise<{ user: User; orgs: Organization[] }>;
}

import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  pgEnum,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", [
  "memento_admin",
  "admin",
  "limited_admin",
  "limited",
  /**
   * Throwaway trial identity minted by "Continue as guest" on the login
   * page. Lowest privilege in the hierarchy and deliberately NOT a
   * subset of `limited`: guests fail every `requireRole` gate that does
   * not name them explicitly, and the server-side allow-list in
   * `shared/middlewares/guestAllowlist.ts` closes every endpoint that
   * isn't explicitly opened. Never assignable from an IDP claim.
   */
  "guest",
]);

/**
 * How the user authenticates. `local` users (seeded admins, dev-login,
 * password-only accounts) keep the pre-org global view; `oidc` users
 * are bounded by their active organization; `guest` users are anonymous
 * trial identities bound to a single browser session and hard-deleted
 * when their `guest_sessions` row expires. Defaults to `local` so all
 * existing rows preserve their behavior on rollout.
 */
export const authSourceEnum = pgEnum("auth_source", [
  "local",
  "oidc",
  "guest",
]);

/**
 * Primary-navigation layout the user prefers. `top` keeps the
 * pre-existing top bar; `side` swaps the shell to a left-hand side
 * nav. Stored per-user (not per-org) so it follows the user across
 * browsers and devices. Defaults to `top` so existing users see no
 * change until they opt in under Settings → Appearance.
 */
export const navLayoutEnum = pgEnum("nav_layout", ["top", "side"]);

export const usersTable = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: text("username").notNull().unique(),
  // Nullable so the dev-login shortcut can mint passwordless rows.
  passwordHash: text("password_hash"),
  role: userRoleEnum("role").notNull().default("limited"),
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull().default({}),
  firstName: text("first_name"),
  lastName: text("last_name"),
  title: text("title"),
  email: text("email"),
  loginCount: integer("login_count").notNull().default(0),
  /**
   * Onboarding flag: true once the user has dismissed (or completed) the
   * 5-step coachmark tour. Defaults to false so brand-new users see the
   * tour on their first sign-in. The Help menu can reset this to false
   * to relaunch the tour on demand.
   */
  hasSeenTour: boolean("has_seen_tour").notNull().default(false),
  /**
   * Identity source. `local` is the pre-existing local username/password
   * (or dev-login / seeded) path; `oidc` is set by the OIDC provisioner
   * so org-scope resolution can distinguish IDP users with zero orgs
   * (= "no project access") from local users (= global access).
   */
  authSource: authSourceEnum("auth_source").notNull().default("local"),
  /**
   * Stable IDP subject (e.g. OIDC `sub`). Set ONLY when `authSource =
   * 'oidc'`; null for local users. Unique so two IDP users can never
   * collide on the same row, and so re-logins find the same row even
   * if the IDP later changes the user's `preferred_username` or email.
   * Critically, identity matching keys off this column rather than
   * `username`, so an IDP subject that happens to equal a local
   * admin's username can never mutate or take over that local row.
   */
  oidcSubject: text("oidc_subject").unique(),
  /**
   * IDP-side identifier for users that were provisioned through the
   * external Identity Provider (Nexus today). Set by the Add user
   * dialog when "Provision in identity provider" is checked, and used
   * by the "Resend welcome email" action to call the IDP per-user
   * endpoint. Null for local username/password users. Unique so two
   * memento rows can never claim the same IDP account.
   *
   * Today this is populated with the GUID Nexus returns from
   * `POST /api/users/provision`. Memento does not interpret the value
   * beyond passing it back to the IDP.
   */
  idpExternalId: text("idp_external_id").unique(),
  /**
   * The memento organization id the user was originally provisioned
   * into via the IDP (Nexus today). Set by the Add user dialog when
   * "Provision in identity provider" is checked, and used by
   * "Resend welcome email" to look up the right per-org Nexus
   * partner API key. Null for local username/password users and for
   * legacy IDP users that were provisioned before this column
   * existed; in that case the resend-welcome path falls back to the
   * calling admin's currently-active org.
   *
   * On-delete `set null` so deleting an organization does not block
   * deleting its long-lived user rows.
   */
  provisionedInOrgId: uuid("provisioned_in_org_id"),
  /**
   * Primary-navigation layout preference. See `navLayoutEnum`.
   */
  navLayout: navLayoutEnum("nav_layout").notNull().default("top"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  lastLoginAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type UserRole = User["role"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isProfileComplete(user: Pick<User, "firstName" | "lastName" | "title" | "email">): boolean {
  return (
    !!user.firstName?.trim() &&
    !!user.lastName?.trim() &&
    !!user.title?.trim() &&
    !!user.email?.trim() &&
    EMAIL_RE.test(user.email.trim())
  );
}

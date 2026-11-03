import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

/**
 * Per-organization role enum. Mirrors `user_role` minus `memento_admin`
 * — the god-mode super role lives exclusively on `users.role` and is
 * org-independent, so it must not appear on a membership row. SSO
 * provisioning writes one of these values on each `user_organizations`
 * row to record the user's role *within that org*.
 */
export const userOrgRoleEnum = pgEnum("user_org_role", [
  "admin",
  "limited_admin",
  "limited",
]);

/**
 * Membership join between users and organizations. Rows are created /
 * deleted by the OIDC login flow on every successful sign-in so the
 * memento view of an IDP user's orgs always matches the IDP claim.
 *
 * `role` is the user's effective memento role *within this org*,
 * written by the OIDC provisioner from the IDP's per-org role claim.
 * It is the source of truth for org-scoped authorization for SSO users
 * (resolved through `resolveEffectiveRole(user, activeOrgId)`).
 *
 * `idpRole` is the raw role string the IDP reported for the user
 * within the org (kept for audit/debug; the typed `role` column is the
 * one memento authorization consumes).
 */
export const userOrganizationsTable = pgTable(
  "user_organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    role: userOrgRoleEnum("role").notNull().default("limited"),
    idpRole: text("idp_role"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("UQ_user_organizations_user_org").on(
      t.userId,
      t.organizationId,
    ),
    index("IDX_user_organizations_user").on(t.userId),
    index("IDX_user_organizations_org").on(t.organizationId),
  ],
);

export const insertUserOrganizationSchema = createInsertSchema(
  userOrganizationsTable,
).omit({ id: true, createdAt: true });

export type InsertUserOrganization = z.infer<
  typeof insertUserOrganizationSchema
>;
export type UserOrganization = typeof userOrganizationsTable.$inferSelect;

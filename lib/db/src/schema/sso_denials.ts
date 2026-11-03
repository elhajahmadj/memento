import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Audit trail of SSO sign-in attempts that were rejected by the
 * Nexus claim gates added in task #1 (`mementoUser` user-gate and
 * `mementoAccess` org-gate). Surfaced under Admin → Source control →
 * SSO denials so an admin can confirm a user actually attempted a
 * sign-in and answer "yes I see your request, here's how to grant
 * access in Nexus" without grepping production logs.
 *
 * Rows are written from the SSO callback's deny branches BEFORE the
 * redirect — no `users` row is ever provisioned for a denied
 * attempt, so the IDP subject is the only stable identifier we have.
 * Email is best-effort (it's only present when the IDP includes it
 * in the id_token/userinfo claims).
 *
 * Old rows are pruned (>30 days) lazily on each list call.
 *
 * Once an admin has granted the user access in Nexus (or otherwise
 * resolved the denial), they can mark the row as handled via
 * `PATCH /sso-denials/:id`. Handled rows are hidden from the default
 * list view but resurface under the "Show handled" toggle so the
 * queue only shows fresh, actionable denials.
 */
export const ssoDenialsTable = pgTable(
  "sso_denials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Stable IDP user identifier (the `sub` claim). */
    subject: text("subject").notNull(),
    /** Email from claims, if present. Best-effort. */
    email: text("email"),
    /**
     * Which gate failed: `no_memento_user` (no `mementoUser` claim),
     * `no_memento_access` (bound org lacks `mementoAccess`), or
     * `no_org` (legacy zero-orgs case kept for completeness).
     */
    gate: text("gate").notNull(),
    /**
     * The bound org id from the IDP claims, if any. Stored as a
     * plain text external key (not a FK) — by design we don't
     * provision the user OR the org row on a denial, so there's
     * nothing local to reference.
     */
    orgKey: text("org_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * When an admin marked this denial as handled (cleared/dismissed),
     * or NULL while still open. Set/cleared by `PATCH /sso-denials/:id`.
     */
    handledAt: timestamp("handled_at", { withTimezone: true }),
    /**
     * The admin who handled the denial. SET NULL on user delete so we
     * retain the historical handled-at timestamp even if the admin's
     * account is later removed.
     */
    handledByUserId: uuid("handled_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [index("IDX_sso_denials_created_at").on(t.createdAt)],
);

export const insertSsoDenialSchema = createInsertSchema(ssoDenialsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertSsoDenial = z.infer<typeof insertSsoDenialSchema>;
export type SsoDenial = typeof ssoDenialsTable.$inferSelect;

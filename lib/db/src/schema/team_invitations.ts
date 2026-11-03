import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Pending team invitations created from Team Admin → Invite teammate.
 *
 * A row is written for every invitation regardless of delivery method
 * (email, copy-link, IDP). The token is the secret embedded in the
 * `/accept-invite?token=…` URL the recipient receives; resending an
 * invitation rotates the token so older copies stop working.
 *
 * `status` transitions: `pending` → (`accepted` | `revoked` | `expired`).
 * Accepted rows are kept for audit; revoked rows are kept so an admin
 * can see the history of who was invited.
 */
export const teamInvitationsTable = pgTable(
  "team_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Lower-cased recipient email. Always required. */
    email: text("email").notNull(),
    /**
     * Memento role to grant when the invitation is accepted. One of
     * the four canonical roles; `memento_admin` is only valid when
     * the inviter is themselves a Memento Admin.
     */
    role: text("role").notNull(),
    /**
     * Which org the invitation grants access to. Null for invitations
     * targeting local username/password accounts that aren't org-scoped.
     */
    organizationId: uuid("organization_id"),
    /**
     * How the invitation will be delivered:
     *   - `email`     — send via SMTP (when configured)
     *   - `copy_link` — admin copies the accept URL out of band
     *   - `idp`       — provision in the IDP (Nexus); no local
     *                   accept-URL flow
     */
    deliveryMethod: text("delivery_method").notNull(),
    /** Optional first name supplied by the inviter. */
    firstName: text("first_name"),
    /** Optional last name supplied by the inviter. */
    lastName: text("last_name"),
    /**
     * One-time secret embedded in the accept URL. Rotated whenever
     * the invitation is resent so older links stop working.
     */
    token: text("token").notNull(),
    /** Lifecycle state: pending, accepted, revoked, expired. */
    status: text("status").notNull().default("pending"),
    /** When the invitation token stops being valid. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Loose reference to the inviting admin's `users.id`. */
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Resolved `users.id` after acceptance. */
    acceptedByUserId: uuid("accepted_by_user_id"),
  },
  (t) => [
    index("IDX_team_invitations_email").on(t.email),
    index("IDX_team_invitations_status").on(t.status),
    index("IDX_team_invitations_organization").on(t.organizationId),
    uniqueIndex("UQ_team_invitations_token").on(t.token),
  ],
);

export const insertTeamInvitationSchema = createInsertSchema(
  teamInvitationsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTeamInvitation = z.infer<typeof insertTeamInvitationSchema>;
export type TeamInvitation = typeof teamInvitationsTable.$inferSelect;

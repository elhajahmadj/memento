import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Pending in-app "Request access" submissions from the SSO deny banner
 * on `/login`. Persisted from the unauthenticated
 * `POST /auth/sso/request-access` endpoint so that users on
 * locked-down devices (no desktop mail client) still have a way to
 * reach an admin, AND so admins get an audit trail / visible queue
 * inside memento itself.
 *
 * Rows are written without any session — the requester is anonymous
 * to memento; `email` is captured from the form so an admin can reply.
 * `orgKey` is the IDP `externalKey` of the org the user tried to sign
 * in to (when the deny banner had it) and is plain text — by design we
 * don't provision the org row on a denial, so there's nothing local to
 * reference.
 */
export const ssoAccessRequestsTable = pgTable(
  "sso_access_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Email the requester typed into the form. Required. */
    email: text("email").notNull(),
    /**
     * Which deny gate triggered the request: `no_memento_user`,
     * `no_memento_access`, or `no_org`.
     */
    gate: text("gate").notNull(),
    /** Bound org external key from the IDP claims, if any. */
    orgKey: text("org_key"),
    /** Free-text justification typed by the requester. Optional. */
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * When an admin marked the request handled (granted or
     * dismissed). Null while the row is still pending.
     */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /**
     * `users.id` of the admin who marked the request handled. Null
     * while pending. Kept as a loose reference (no FK) so deleting an
     * admin user doesn't blow away the audit trail.
     */
    resolvedByUserId: uuid("resolved_by_user_id"),
  },
  (t) => [
    index("IDX_sso_access_requests_created_at").on(t.createdAt),
    index("IDX_sso_access_requests_resolved_at").on(t.resolvedAt),
  ],
);

export const insertSsoAccessRequestSchema = createInsertSchema(
  ssoAccessRequestsTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertSsoAccessRequest = z.infer<
  typeof insertSsoAccessRequestSchema
>;
export type SsoAccessRequest = typeof ssoAccessRequestsTable.$inferSelect;

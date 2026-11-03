import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * An external IDP organization (or "tenant" / "group"). One row per
 * distinct value of the configured org claim. Local users (those who
 * authenticated via username/password) never belong to an organization
 * and continue to see every project as before; org-scoping only applies
 * to users provisioned through the OIDC provider.
 */
export const organizationsTable = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The raw value of the org claim from the IDP (case-sensitive). */
    externalKey: text("external_key").notNull(),
    /** Human-friendly name shown in the UI; defaults to the external key. */
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("UQ_organizations_external_key").on(t.externalKey)],
);

export const insertOrganizationSchema = createInsertSchema(
  organizationsTable,
).omit({ id: true, createdAt: true });

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizationsTable.$inferSelect;

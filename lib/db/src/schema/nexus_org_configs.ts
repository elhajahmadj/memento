import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

/**
 * Per-organization Nexus partner API key. One row per memento
 * organization. Each org admin pastes the partner key they minted
 * inside Nexus for *their* tenant; only admins of that org (plus
 * Memento Admins) can read or mutate the row.
 *
 * The plaintext key is never returned by the API — only
 * `apiKeyLastFour` is exposed for UI display. The encryption scheme
 * matches `ai_agent_org_configs` and `project_git_configs` so the
 * single `PROJECT_SECRETS_KEY` env var covers every per-tenant secret
 * memento stores.
 *
 * When a row is absent (or its row was deleted), the IDP provisioner
 * falls back to the deployment-wide `NEXUS_API_KEY` env var so
 * single-tenant deployments keep working unchanged.
 */
export const nexusOrgConfigsTable = pgTable(
  "nexus_org_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    /** AES-256-GCM ciphertext (`v1:<iv>:<tag>:<ct>`). */
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    /** Last four characters of the API key, safe to display. */
    apiKeyLastFour: text("api_key_last_four").notNull(),
    updatedByUserId: uuid("updated_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("UQ_nexus_org_configs_org").on(t.organizationId)],
);

export const insertNexusOrgConfigSchema = createInsertSchema(
  nexusOrgConfigsTable,
).omit({ id: true, updatedAt: true });

export type InsertNexusOrgConfig = z.infer<typeof insertNexusOrgConfigSchema>;
export type NexusOrgConfig = typeof nexusOrgConfigsTable.$inferSelect;

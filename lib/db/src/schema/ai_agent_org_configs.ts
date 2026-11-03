import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Per-organization AI Agent configuration. One row per org. Stores the
 * org-wide enabled flag and the configured LLM provider + encrypted
 * API key. The plaintext key is never returned by the API — only
 * `apiKeyLastFour` is exposed for UI display.
 *
 * `organizationId` is `null` for the implicit "local-users" org
 * (matches the rest of the project_organizations / org-scope policy).
 */
export const aiAgentOrgConfigsTable = pgTable(
  "ai_agent_org_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id"),
    enabled: boolean("enabled").notNull().default(false),
    /**
     * One of the eight supported provider identifiers ("anthropic",
     * "openai", "gemini", "openrouter", "azure_openai", "groq",
     * "deepseek", "mistral") — null when no key has been set yet.
     */
    provider: text("provider"),
    /** AES-256-GCM ciphertext (`v1:<iv>:<tag>:<ct>`); null if unset. */
    apiKeyEncrypted: text("api_key_encrypted"),
    /** Last four characters of the API key, safe to display. */
    apiKeyLastFour: text("api_key_last_four"),
    apiKeySetAt: timestamp("api_key_set_at", { withTimezone: true }),
    /**
     * Free-form model identifier the admin chose. Null means "use the
     * adapter's per-provider default". For Azure OpenAI this carries
     * the **deployment name** (Azure uses deployment names, not
     * model IDs).
     */
    model: text("model"),
    /** Azure OpenAI only — resource endpoint, e.g. `https://x.openai.azure.com`. */
    endpointUrl: text("endpoint_url"),
    /** Azure OpenAI only — REST API version, e.g. `2024-10-21`. */
    apiVersion: text("api_version"),
    /** OpenRouter optional — sent as `HTTP-Referer` for attribution. */
    refererUrl: text("referer_url"),
    /** OpenRouter optional — sent as `X-Title` for attribution. */
    appName: text("app_name"),
    updatedByUserId: uuid("updated_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("UQ_ai_agent_org_configs_org").on(t.organizationId),
  ],
);

export const insertAiAgentOrgConfigSchema = createInsertSchema(
  aiAgentOrgConfigsTable,
).omit({ id: true, updatedAt: true });

export type InsertAiAgentOrgConfig = z.infer<
  typeof insertAiAgentOrgConfigSchema
>;
export type AiAgentOrgConfig = typeof aiAgentOrgConfigsTable.$inferSelect;

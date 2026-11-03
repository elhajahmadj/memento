import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Reusable AI provider keys managed under Tools → AI Agent → Keys.
 * Unlike the legacy single-key columns on `ai_agent_org_configs`,
 * each organization can register many keys here and mark exactly one
 * as the default. Individual projects may opt-in to a non-default
 * key via `ai_agent_project_configs.ai_key_id`.
 *
 * The plaintext key is encrypted at rest with the same
 * `PROJECT_SECRETS_KEY`-derived AES-256-GCM key as Repo PATs (see
 * `artifacts/api-server/src/shared/crypto.ts`). The API never
 * returns the plaintext — only `apiKeyLastFour` and the
 * non-secret provider-specific fields.
 *
 * `organizationId` is `null` for the implicit "local-users" org
 * (matches the rest of the project_organizations / org-scope
 * policy).
 */
export const aiAgentKeysTable = pgTable(
  "ai_agent_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id"),
    name: text("name").notNull(),
    /**
     * One of the eight supported provider identifiers ("anthropic",
     * "openai", "gemini", "openrouter", "azure_openai", "groq",
     * "deepseek", "mistral").
     */
    provider: text("provider").notNull(),
    /** AES-256-GCM ciphertext (`v1:<iv>:<tag>:<ct>`). */
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    /** Last four characters of the API key, safe to display. */
    apiKeyLastFour: text("api_key_last_four").notNull(),
    /**
     * Free-form model identifier the admin chose. Null means "use
     * the adapter's per-provider default". For Azure OpenAI this
     * carries the **deployment name**.
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
    /**
     * Exactly one row per org may have `isDefault = true` — enforced
     * by the partial unique index below. The default is what
     * `resolveActiveKey` falls back to when a project has no
     * explicit override.
     */
    isDefault: boolean("is_default").notNull().default(false),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    updatedByUserId: uuid("updated_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Names are unique within an organization (so the UI can show
    // a friendly label and admins can rename without collision).
    // The null-organization scope (local users) is treated as its
    // own bucket by Postgres' default NULL-distinct behavior, so
    // names there are also unique among local-org rows.
    // Coalesce nulls into a sentinel bucket so the local-users
    // (organizationId IS NULL) scope also gets DB-level uniqueness.
    // Without coalesce, Postgres treats NULLs as distinct and two
    // local-org rows could share the same name.
    uniqueIndex("UQ_ai_agent_keys_org_name").on(
      sql`coalesce(${t.organizationId}, '__local__')`,
      t.name,
    ),
    // At most one default per org. Partial index excludes non-default
    // rows so multiple non-defaults can coexist. We index
    // `coalesce(organization_id, '__local__')` rather than the raw
    // column because Postgres treats NULL values as distinct in a
    // unique index — without the coalesce, the local-users org
    // (organizationId = NULL) could otherwise have multiple defaults.
    uniqueIndex("UQ_ai_agent_keys_org_default")
      .on(sql`coalesce(${t.organizationId}, '__local__')`)
      .where(sql`${t.isDefault} = true`),
  ],
);

export const insertAiAgentKeySchema = createInsertSchema(aiAgentKeysTable).omit(
  { id: true, createdAt: true, updatedAt: true },
);

export type InsertAiAgentKey = z.infer<typeof insertAiAgentKeySchema>;
export type AiAgentKey = typeof aiAgentKeysTable.$inferSelect;

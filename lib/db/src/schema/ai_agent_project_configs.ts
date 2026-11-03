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
import { aiAgentKeysTable } from "./ai_agent_keys";

/**
 * Per-project AI Agent toggle. The org-level switch must also be on
 * for the agent to be available; this is purely a project-level
 * gate that lets admins disable AI on specific projects within an
 * org-enabled workspace.
 */
export const aiAgentProjectConfigsTable = pgTable(
  "ai_agent_project_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectName: text("project_name").notNull(),
    /** Default `true` — once the org enables the agent, projects opt-out. */
    enabled: boolean("enabled").notNull().default(true),
    /**
     * When set, overrides the org default key for this project. Null
     * means "use whichever `ai_agent_keys` row is marked as the org
     * default at request time". `ON DELETE RESTRICT` is enforced by
     * the bound-projects delete guard in the key service.
     */
    aiKeyId: uuid("ai_key_id").references(() => aiAgentKeysTable.id, {
      onDelete: "restrict",
    }),
    updatedByUserId: uuid("updated_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("UQ_ai_agent_project_configs_project").on(t.projectName),
  ],
);

export const insertAiAgentProjectConfigSchema = createInsertSchema(
  aiAgentProjectConfigsTable,
).omit({ id: true, updatedAt: true });

export type InsertAiAgentProjectConfig = z.infer<
  typeof insertAiAgentProjectConfigSchema
>;
export type AiAgentProjectConfig =
  typeof aiAgentProjectConfigsTable.$inferSelect;

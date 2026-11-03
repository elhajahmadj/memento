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

/**
 * Reusable Git Personal Access Tokens managed under
 * Admin → Source control → Repos PAT. Unlike
 * `project_git_configs` (one PAT per project), these rows are
 * intended to be referenced from many projects and from the
 * "Clone from repo" flow.
 *
 * The PAT plaintext is encrypted at rest with the same
 * `PROJECT_SECRETS_KEY`-derived AES-256-GCM key as project git
 * configs (see `artifacts/api-server/src/shared/crypto.ts`). The
 * API never returns the plaintext — only `provider`, `name`,
 * `patLastFour`, and timestamps.
 */
export const repoPatsTable = pgTable(
  "repo_pats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    name: text("name").notNull(),
    /**
     * Opaque ciphertext blob produced by `encryptSecret()` — format
     * `v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`.
     */
    patEncrypted: text("pat_encrypted").notNull(),
    /** Last four characters of the PAT — safe to display in the UI. */
    patLastFour: text("pat_last_four").notNull(),
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
  (t) => [uniqueIndex("UQ_repo_pats_provider_name").on(t.provider, t.name)],
);

export const insertRepoPatSchema = createInsertSchema(repoPatsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRepoPat = z.infer<typeof insertRepoPatSchema>;
export type RepoPat = typeof repoPatsTable.$inferSelect;

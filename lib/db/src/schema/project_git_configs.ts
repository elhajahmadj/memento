import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { repoPatsTable } from "./repo_pats";

/**
 * Per-project Git provider configuration. A row either stores an
 * inline PAT (encrypted at rest with `PROJECT_SECRETS_KEY`) OR points
 * at a reusable `repo_pats` row via `repoPatId` — never both. The
 * effective provider for git operations is the inline `provider`
 * column for inline-PAT rows and the referenced `repo_pats.provider`
 * for shared-PAT rows.
 *
 * The plaintext PAT is never returned by the API — the UI only ever
 * sees `patLastFour` and a "set / not set" indicator via `patSetAt`,
 * plus (for shared-PAT rows) the linked Repo PAT's name and provider.
 */
export const projectGitConfigsTable = pgTable(
  "project_git_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectName: text("project_name").notNull(),
    provider: text("provider").notNull().default("azure_repos"),
    repoUrl: text("repo_url").notNull(),
    branch: text("branch").notNull().default("main"),
    /**
     * Opaque ciphertext blob produced by `encryptSecret()` — format
     * `v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`. Decrypted only inside
     * the api-server when issuing a clone. Null when this row uses a
     * shared `repo_pats` row instead.
     */
    patEncrypted: text("pat_encrypted"),
    /** Last four characters of the PAT — safe to display in the UI. */
    patLastFour: text("pat_last_four"),
    /** When the current inline PAT was stored. Null for shared-PAT rows. */
    patSetAt: timestamp("pat_set_at", { withTimezone: true }),
    /**
     * When non-null, the project resolves its PAT from this shared
     * `repo_pats` row at request time instead of from the inline
     * `patEncrypted` column. The two are mutually exclusive (enforced
     * by the check constraint below).
     */
    repoPatId: uuid("repo_pat_id").references(() => repoPatsTable.id, {
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
    uniqueIndex("UQ_project_git_configs_project").on(t.projectName),
    // Exactly one of (inline PAT) | (shared repo PAT reference).
    check(
      "CK_project_git_configs_pat_source",
      sql`(${t.repoPatId} IS NOT NULL AND ${t.patEncrypted} IS NULL AND ${t.patLastFour} IS NULL AND ${t.patSetAt} IS NULL)
          OR (${t.repoPatId} IS NULL AND ${t.patEncrypted} IS NOT NULL AND ${t.patLastFour} IS NOT NULL AND ${t.patSetAt} IS NOT NULL)`,
    ),
  ],
);

export const insertProjectGitConfigSchema = createInsertSchema(
  projectGitConfigsTable,
).omit({ id: true, patSetAt: true, updatedAt: true });

export type InsertProjectGitConfig = z.infer<typeof insertProjectGitConfigSchema>;
export type ProjectGitConfig = typeof projectGitConfigsTable.$inferSelect;

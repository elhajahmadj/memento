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
 * Per-user personal fork configuration for a project. Each row is
 * owned by exactly one user and stores their own Git provider, repo
 * URL, and Personal Access Token. When present, the workstation Push
 * action targets this fork instead of the project's shared upstream
 * config in `project_git_configs`. Pulls always use the shared
 * upstream.
 *
 * The PAT is encrypted at rest with the same `PROJECT_SECRETS_KEY`-
 * derived AES-256-GCM key as project git configs (see
 * `artifacts/api-server/src/shared/crypto.ts`). The API never returns
 * the plaintext — only `provider`, `repoUrl`, `patLastFour`, and
 * timestamps.
 */
export const userProjectForksTable = pgTable(
  "user_project_forks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    projectName: text("project_name").notNull(),
    provider: text("provider").notNull().default("azure_repos"),
    repoUrl: text("repo_url").notNull(),
    patEncrypted: text("pat_encrypted").notNull(),
    patLastFour: text("pat_last_four").notNull(),
    patSetAt: timestamp("pat_set_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("UQ_user_project_forks_user_project").on(
      t.userId,
      t.projectName,
    ),
  ],
);

export const insertUserProjectForkSchema = createInsertSchema(
  userProjectForksTable,
).omit({ id: true, patSetAt: true, createdAt: true, updatedAt: true });

export type InsertUserProjectFork = z.infer<typeof insertUserProjectForkSchema>;
export type UserProjectFork = typeof userProjectForksTable.$inferSelect;

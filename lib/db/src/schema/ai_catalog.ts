import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  doublePrecision,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-project AI catalog tables — the "living library" the agent
 * builds up over time. All three follow the same shape:
 *  - `projectName` + `name` are unique together.
 *  - `source` is `user` (pre-defined) or `ai` (auto-created).
 *  - `confidence` is set on AI-created/matched entries.
 *  - `createdInRunId` points at the `ai_runs` row that introduced it.
 */

export const aiCatalogMethodsTable = pgTable(
  "ai_catalog_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectName: text("project_name").notNull(),
    /** PascalCase, e.g. `LoginAsAdmin`. */
    name: text("name").notNull(),
    /** Optional declared parameters: `["itemName"]`. */
    params: jsonb("params"),
    /** Free-form description / human notes. */
    description: text("description"),
    /** `user` | `ai`. */
    source: text("source").notNull(),
    confidence: doublePrecision("confidence"),
    createdInRunId: uuid("created_in_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("UQ_ai_catalog_methods_project_name").on(
      t.projectName,
      t.name,
    ),
  ],
);

export const aiCatalogSelectorsTable = pgTable(
  "ai_catalog_selectors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectName: text("project_name").notNull(),
    /** camelCase, e.g. `loginButton`. */
    name: text("name").notNull(),
    /** Underlying CSS / Playwright selector. */
    selector: text("selector").notNull(),
    source: text("source").notNull(),
    confidence: doublePrecision("confidence"),
    createdInRunId: uuid("created_in_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("UQ_ai_catalog_selectors_project_name").on(
      t.projectName,
      t.name,
    ),
  ],
);

export const aiCatalogCategoriesTable = pgTable(
  "ai_catalog_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectName: text("project_name").notNull(),
    /** Title Case, e.g. `Smoke Tests`. */
    name: text("name").notNull(),
    source: text("source").notNull(),
    createdInRunId: uuid("created_in_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("UQ_ai_catalog_categories_project_name").on(
      t.projectName,
      t.name,
    ),
  ],
);

export const insertAiCatalogMethodSchema = createInsertSchema(
  aiCatalogMethodsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAiCatalogSelectorSchema = createInsertSchema(
  aiCatalogSelectorsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAiCatalogCategorySchema = createInsertSchema(
  aiCatalogCategoriesTable,
).omit({ id: true, createdAt: true });

export type InsertAiCatalogMethod = z.infer<typeof insertAiCatalogMethodSchema>;
export type InsertAiCatalogSelector = z.infer<
  typeof insertAiCatalogSelectorSchema
>;
export type InsertAiCatalogCategory = z.infer<
  typeof insertAiCatalogCategorySchema
>;
export type AiCatalogMethod = typeof aiCatalogMethodsTable.$inferSelect;
export type AiCatalogSelector = typeof aiCatalogSelectorsTable.$inferSelect;
export type AiCatalogCategory = typeof aiCatalogCategoriesTable.$inferSelect;

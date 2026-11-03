import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Project-scoped network mock rules. Each row maps a URL glob pattern to
 * a canned response that the recorder + replay services install via
 * `page.route()` before navigation. Rules are scoped to a single user
 * (admin or limited) within a single project so two users editing the
 * same project never inherit each other's mocks; admins working on a
 * shared project simply create matching rules in their own row set.
 *
 * The body payload is stored as JSON. When `bodyJson` is null we treat
 * the rule as "fulfill with empty body + Content-Type: application/json".
 *
 * Disabled rules remain in the table so they can be toggled back on
 * without losing the carefully crafted URL pattern + payload.
 */
export const routeMocksTable = pgTable(
  "route_mocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    projectName: text("project_name").notNull(),
    name: text("name").notNull(),
    method: text("method", {
      enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    })
      .notNull()
      .default("GET"),
    urlPattern: text("url_pattern").notNull(),
    status: integer("status").notNull().default(200),
    bodyJson: jsonb("body_json"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    perProjectNameUnique: uniqueIndex(
      "route_mocks_per_project_name_unique",
    ).on(t.userId, t.projectName, t.name),
  }),
);

export const insertRouteMockSchema = createInsertSchema(routeMocksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRouteMock = z.infer<typeof insertRouteMockSchema>;
export type RouteMockRow = typeof routeMocksTable.$inferSelect;
export type RouteMockMethod = RouteMockRow["method"];

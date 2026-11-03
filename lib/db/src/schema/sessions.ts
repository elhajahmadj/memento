import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Express session store table used by `connect-pg-simple`.
 * The column shape (`sid`, `sess`, `expire`) is dictated by that library and
 * must not be changed.
 */
export const userSessionsTable = pgTable(
  "user_sessions",
  {
    sid: varchar("sid").primaryKey().notNull(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6, withTimezone: false }).notNull(),
  },
  (t) => [index("IDX_user_sessions_expire").on(t.expire)],
);

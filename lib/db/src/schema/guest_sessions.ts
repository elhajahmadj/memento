import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * One row per active guest ("Continue as guest") trial identity.
 *
 * The row is BOTH the slot reservation and the TTL record, and it is
 * created the moment the visitor clicks the button — before any project
 * exists. That ordering is what makes the deployment-wide concurrency
 * cap enforceable at click time: if 30 unexpired rows already exist we
 * can refuse to mint a 31st guest, which is exactly the behavior the
 * product asks for ("max guests used, try again later").
 *
 * `projectName` stays null until the guest scaffolds their single
 * project, at which point it is filled in and never changes — the
 * one-project-per-guest rule is just "this column is already set".
 * It also doubles as the guest's entire project visibility scope (see
 * the `guest` variant of `ScopePolicy` in
 * `features/auth/infrastructure/orgScope.ts`), so a guest can never
 * observe or load anyone else's project.
 *
 * The reaper (`features/guest/infrastructure/guestSessionService.ts`)
 * deletes the on-disk workspace directory, the `user_sessions` row, and
 * finally the owning `users` row once `expiresAt` passes. The cascade
 * on `userId` means deleting the user takes this row with it, along
 * with the guest's `audit_events`, `recorded_action_sets`,
 * `auth_states`, `route_mocks`, and `validation_runs`.
 */
export const guestSessionsTable = pgTable(
  "guest_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /**
     * Owning throwaway user. Unique so a single guest identity can
     * never hold two slots, and `on delete cascade` so reaping the
     * user row is sufficient to release the slot.
     */
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /**
     * Solution name of the guest's one project. Null until they create
     * it. Not a foreign key — projects live on disk under
     * `workspace/<solutionName>/`, not in a table.
     */
    projectName: text("project_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Hard-delete deadline: `createdAt + GUEST_TTL_MS`. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("IDX_guest_sessions_expires_at").on(t.expiresAt)],
);

export const insertGuestSessionSchema = createInsertSchema(
  guestSessionsTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertGuestSession = z.infer<typeof insertGuestSessionSchema>;
export type GuestSession = typeof guestSessionsTable.$inferSelect;

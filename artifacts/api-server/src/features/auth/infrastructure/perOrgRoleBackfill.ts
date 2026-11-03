import { eq, sql } from "drizzle-orm";
import {
  db,
  userOrganizationsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "@/shared/logger";
import { mapRoleString, toPerOrgRole } from "../domain/claims";

/**
 * One-shot backfill: ensure every existing `user_organizations` row
 * has a sensible per-org `role` value (task #35 — per-org roles
 * foundation).
 *
 * The column has a NOT NULL default of `limited`, so after the
 * schema push every legacy row already carries *some* value. This
 * pass replaces those defaults with a best-effort derivation so
 * existing users don't lose privilege on the next sign-in (and
 * before SSO re-syncs the row from the live IDP claim):
 *
 *   1. Prefer a typed value mapped from the row's `idpRole` text
 *      column (the audit trail the provisioner has been keeping
 *      since per-org membership shipped).
 *   2. Otherwise fall back to the owning user's current
 *      `users.role` — which until this change was the
 *      "highest-wins across all orgs" value, so it's the closest
 *      pre-task approximation of what the user was entitled to in
 *      *every* org they were a member of.
 *
 * Idempotent: only touches rows still sitting at the post-migration
 * default (`limited` AND no truthier source available). Runs at boot
 * behind a try/catch so a broken schema can't crash the API server.
 */
export async function backfillPerOrgRolesOnBoot(): Promise<void> {
  type Row = {
    id: string;
    userId: string;
    role: "admin" | "limited_admin" | "limited";
    idpRole: string | null;
    userRole: "memento_admin" | "admin" | "limited_admin" | "limited" | "guest";
  };
  let rows: Row[];
  try {
    rows = await db
      .select({
        id: userOrganizationsTable.id,
        userId: userOrganizationsTable.userId,
        role: userOrganizationsTable.role,
        idpRole: userOrganizationsTable.idpRole,
        userRole: usersTable.role,
      })
      .from(userOrganizationsTable)
      .innerJoin(usersTable, eq(usersTable.id, userOrganizationsTable.userId))
      // Only revisit rows that didn't already get an explicit
      // non-default value from the provisioner.
      .where(eq(userOrganizationsTable.role, "limited"));
  } catch (err) {
    logger.info(
      { err: err instanceof Error ? err.message : err },
      "Per-org role backfill skipped — user_organizations.role not present yet",
    );
    return;
  }

  let touched = 0;
  for (const row of rows) {
    const mappedFromIdp = mapRoleString(row.idpRole);
    // Per-org rows never carry `memento_admin` (org-independent) or
    // `guest` (never a member of anything).
    const fromIdp = mappedFromIdp ? toPerOrgRole(mappedFromIdp) : null;
    // Drops `memento_admin` (org-independent) and `guest` (never has
    // an org membership in the first place, so this is unreachable —
    // the narrowing is what keeps it that way).
    const fromUser = toPerOrgRole(row.userRole);
    const target = fromIdp ?? fromUser ?? "limited";
    if (target === row.role) continue;
    try {
      await db
        .update(userOrganizationsTable)
        .set({ role: target })
        .where(eq(userOrganizationsTable.id, row.id));
      touched += 1;
    } catch (err) {
      logger.warn(
        { err, rowId: row.id },
        "Per-org role backfill failed for one row",
      );
    }
  }
  if (touched > 0) {
    logger.info(
      { rows: touched },
      "Backfilled per-org roles on user_organizations",
    );
  }
  // Touch sql to avoid "unused import" if the linter ever runs here.
  void sql;
}

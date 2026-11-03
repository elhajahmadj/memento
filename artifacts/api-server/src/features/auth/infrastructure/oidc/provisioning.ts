import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  organizationsTable,
  userOrganizationsTable,
  usersTable,
  type Organization,
  type User,
} from "@workspace/db";
import { logger } from "@/shared/logger";
import { toPerOrgRole, type NormalizedClaims, type PerOrgRole } from "../../domain/claims";

/**
 * Idempotently upsert the orgs and the user, then re-sync the user's
 * `user_organizations` rows to exactly match `orgKeys`. Returns the
 * resulting user and the full list of orgs they belong to.
 */
export async function provisionFromClaims(
  norm: NormalizedClaims,
): Promise<{ user: User; orgs: Organization[] }> {
  // Upsert orgs.
  const orgs: Organization[] = [];
  for (const key of norm.orgKeys) {
    const existing = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.externalKey, key))
      .limit(1);
    if (existing[0]) {
      orgs.push(existing[0]);
    } else {
      const [inserted] = await db
        .insert(organizationsTable)
        .values({
          externalKey: key,
          displayName: norm.orgDisplayNames[key] ?? key,
        })
        .returning();
      if (inserted) orgs.push(inserted);
    }
  }

  // Identity matching uses the IDP subject (stored in `oidc_subject`),
  // NEVER the username. This prevents an IDP subject that happens to
  // equal a local admin's username from mutating or taking over the
  // local row. We only fall back to a username lookup when the row is
  // an existing OIDC row from before `oidc_subject` was introduced.
  const existingBySubject = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.oidcSubject, norm.subject))
    .limit(1);

  // Backfill: legacy OIDC rows created before `oidc_subject` existed
  // had their subject stored in `username`. Adopt them by matching on
  // username AND `authSource = 'oidc'` so we never claim a local row.
  const legacyOidcByUsername =
    existingBySubject.length === 0
      ? await db
          .select()
          .from(usersTable)
          .where(
            and(
              eq(usersTable.username, norm.subject),
              eq(usersTable.authSource, "oidc"),
            ),
          )
          .limit(1)
      : [];

  const existing = existingBySubject[0] ?? legacyOidcByUsername[0] ?? null;

  // For SSO users, `users.role` is reserved exclusively for the
  // org-independent `memento_admin` god-mode super role. Every other
  // SSO user lands at a neutral baseline (`limited`) on the row; the
  // *effective* role for an SSO user is resolved from their
  // `user_organizations.role` for the active org via
  // `resolveEffectiveRole`. This stops the legacy "highest wins
  // across all orgs" promotion from silently elevating a user who's
  // Admin in OrgA + Limited Admin in OrgB to Admin everywhere.
  const userLevelRole: "memento_admin" | "limited" =
    norm.role === "memento_admin" ? "memento_admin" : "limited";

  let user: User;
  if (existing) {
    const [updated] = await db
      .update(usersTable)
      .set({
        email: norm.email ?? existing.email,
        firstName: norm.firstName ?? existing.firstName,
        lastName: norm.lastName ?? existing.lastName,
        lastLoginAt: new Date(),
        loginCount: (existing.loginCount ?? 0) + 1,
        // Always pin to oidc on a successful IDP login so the org-scope
        // policy can distinguish IDP users from local users — even if
        // an admin previously promoted them or the row was created via
        // a legacy code path.
        authSource: "oidc",
        // Backfill the stable subject onto legacy rows.
        oidcSubject: norm.subject,
        // Memento-admin (god-mode) only — every other role lives on
        // the per-org membership row now.
        role: userLevelRole,
      })
      .where(eq(usersTable.id, existing.id))
      .returning();
    user = updated!;
  } else {
    // New OIDC row. Pick a username that cannot collide with an
    // existing local user. Default is `oidc:<subject>`; if that namespace
    // is somehow taken we append a short random suffix until unique.
    let username = `oidc:${norm.subject}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, username))
        .limit(1);
      if (clash.length === 0) break;
      username = `oidc:${norm.subject}-${crypto.randomBytes(3).toString("hex")}`;
    }
    const [created] = await db
      .insert(usersTable)
      .values({
        username,
        oidcSubject: norm.subject,
        passwordHash: null,
        // SSO users land at the memento-admin god-mode role or the
        // neutral `limited` baseline; everything else is per-org and
        // written to `user_organizations.role` below.
        role: userLevelRole,
        email: norm.email,
        firstName: norm.firstName,
        lastName: norm.lastName,
        loginCount: 1,
        lastLoginAt: new Date(),
        profile: {},
        authSource: "oidc",
      })
      .returning();
    user = created!;
  }

  // Re-sync user_organizations: add missing rows, drop extras, and
  // re-apply the per-org role on every membership row so a role
  // change in the IDP takes effect on the user's next sign-in. This
  // is how org membership in the IDP propagates into memento — every
  // login fully re-reads the claim.
  //
  // Per-org role resolution: prefer the role mapped from the matching
  // `organizations[]` entry; fall back to `norm.role` (the top-level
  // role claim) so an IDP that only emits a global role still records
  // a sensible per-org value; final fallback is `limited`.
  const fallbackPerOrgRole: PerOrgRole = toPerOrgRole(norm.role) ?? "limited";
  const roleForOrg = (
    externalKey: string,
  ): "admin" | "limited_admin" | "limited" => {
    const mapped = norm.perOrgRoles.get(externalKey) ?? null;
    return mapped ?? fallbackPerOrgRole;
  };

  const desiredOrgIds = new Set(orgs.map((o) => o.id));
  const currentRows = await db
    .select()
    .from(userOrganizationsTable)
    .where(eq(userOrganizationsTable.userId, user.id));
  const currentOrgIds = new Set(currentRows.map((r) => r.organizationId));

  const toAdd = orgs.filter((o) => !currentOrgIds.has(o.id));
  if (toAdd.length > 0) {
    await db.insert(userOrganizationsTable).values(
      toAdd.map((o) => ({
        userId: user.id,
        organizationId: o.id,
        role: roleForOrg(o.externalKey),
        idpRole: norm.perOrgIdpRoleRaw.get(o.externalKey) ?? null,
      })),
    );
  }
  // Re-apply role on already-present rows so role drift in the IDP
  // is reflected on the user's next login.
  for (const o of orgs) {
    if (!currentOrgIds.has(o.id)) continue;
    await db
      .update(userOrganizationsTable)
      .set({
        role: roleForOrg(o.externalKey),
        idpRole: norm.perOrgIdpRoleRaw.get(o.externalKey) ?? null,
      })
      .where(
        and(
          eq(userOrganizationsTable.userId, user.id),
          eq(userOrganizationsTable.organizationId, o.id),
        ),
      );
  }
  const toRemove = [...currentOrgIds].filter((id) => !desiredOrgIds.has(id));
  if (toRemove.length > 0) {
    await db
      .delete(userOrganizationsTable)
      .where(
        and(
          eq(userOrganizationsTable.userId, user.id),
          inArray(userOrganizationsTable.organizationId, toRemove),
        ),
      );
  }

  logger.info(
    { userId: user.id, orgs: orgs.map((o) => o.externalKey) },
    "Provisioned IDP user",
  );

  return { user, orgs };
}

/** Read the (already-synced) orgs for a user. */
export async function listOrgsForUser(
  userId: string,
): Promise<Organization[]> {
  const rows = await db
    .select({ org: organizationsTable })
    .from(userOrganizationsTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, userOrganizationsTable.organizationId),
    )
    .where(eq(userOrganizationsTable.userId, userId));
  return rows.map((r) => r.org);
}

/**
 * Read the user's orgs *with* their per-org membership role, so the
 * `/auth/me` response can show "Admin in OrgA, Limited Admin in OrgB"
 * without a second round-trip. Returned in the same order as
 * {@link listOrgsForUser}.
 */
export async function listOrgsWithRolesForUser(userId: string): Promise<
  Array<{
    org: Organization;
    role: "admin" | "limited_admin" | "limited";
  }>
> {
  const rows = await db
    .select({
      org: organizationsTable,
      role: userOrganizationsTable.role,
    })
    .from(userOrganizationsTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, userOrganizationsTable.organizationId),
    )
    .where(eq(userOrganizationsTable.userId, userId));
  return rows.map((r) => ({ org: r.org, role: r.role }));
}

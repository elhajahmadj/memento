import { Router, type IRouter } from "express";
import { eq, and, ne, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  userOrganizationsTable,
  organizationsTable,
  type User,
  isProfileComplete,
} from "@workspace/db";
import { UpdateUserBody, CreateUserBody } from "@workspace/api-zod";
import { requireAdmin, requireAnyAdmin } from "@/shared/middlewares/requireRole";
import { getEffectiveRole } from "@/shared/middlewares/effectiveRole";
import { hashPassword } from "@/features/auth/infrastructure/passwordHash";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import {
  getIdpUserProvisioner,
  isIdpProvisioningEnabled,
  mementoRoleToIdpOrgRole,
  IdpInvitationConflictError,
  IdpNotConfiguredError,
  IdpThrottledError,
  IdpUserNotFoundError,
} from "@/features/users/infrastructure/idpProvisioner";
import { InviteUserBody } from "@workspace/api-zod";
import preferencesRouter from "./preferences";

const router: IRouter = Router();
router.use(preferencesRouter);

const NO_ACTIVE_ORG_MESSAGE =
  "Pick an active organization before provisioning IDP users. The new " +
  "user will be attached to whichever org you are currently working in.";

// Returned when an admin tries to manage IDP users (create or resend
// welcome email) without having signed in via SSO. memento's policy is
// that only admins authenticated through Nexus may create or message
// IDP-backed accounts, even though the actual call to Nexus is made
// with the server-side NEXUS_API_KEY. Local username/password admins
// (seeded users, dev-login) get this 403; they can still create
// local-only username/password rows via the same route with
// provisionInIdp=false.
const NO_SSO_TOKEN_MESSAGE =
  "IDP user management requires signing in via SSO. Local " +
  "username/password admins can still create local accounts (set " +
  "provisionInIdp=false) but cannot reach the identity provider.";

function callerHasSsoAccessToken(
  req: import("express").Request,
): boolean {
  return Boolean(req.nexusAccessToken || req.session.oidcAccessToken);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;
const TEMPORARY_PASSWORD = "Temporary1!";

type Membership = {
  organizationId: string;
  organizationName: string;
  role: "admin" | "limited_admin" | "limited";
};

function toAdminUser(user: User, memberships: Membership[] = []) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    title: user.title,
    email: user.email,
    profileComplete: isProfileComplete(user),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    idpExternalId: user.idpExternalId ?? null,
    authSource: user.authSource,
    memberships,
  };
}

async function loadMembershipsForUsers(
  userIds: string[],
): Promise<Map<string, Membership[]>> {
  const out = new Map<string, Membership[]>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({
      userId: userOrganizationsTable.userId,
      organizationId: userOrganizationsTable.organizationId,
      organizationName: organizationsTable.displayName,
      role: userOrganizationsTable.role,
    })
    .from(userOrganizationsTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, userOrganizationsTable.organizationId),
    )
    .where(inArray(userOrganizationsTable.userId, userIds));
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push({
      organizationId: r.organizationId,
      organizationName: r.organizationName,
      role: r.role,
    });
    out.set(r.userId, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.organizationName.localeCompare(b.organizationName));
  }
  return out;
}

async function loadMembershipsForUser(userId: string): Promise<Membership[]> {
  const m = await loadMembershipsForUsers([userId]);
  return m.get(userId) ?? [];
}

router.get("/users", requireAnyAdmin, async (req, res): Promise<void> => {
  // Org-scoping policy: Memento Admin is god-mode and sees every user
  // across every org (the only role allowed to enumerate the whole
  // tenant). Every other admin — including local username/password
  // admins — is narrowed to users who share at least one organization
  // where the caller's own `user_organizations` row grants an
  // admin-level role (`admin` or `limited_admin`). Scope follows the
  // caller's admin assignments, NOT `req.session.activeOrgId`, so the
  // visible row set doesn't change when the admin switches their
  // active org. Callers with no admin memberships get an empty list
  // rather than the historic "all users" fallback that leaked rows
  // across tenants.
  const caller = req.user!;
  let rows;
  if (caller.role === "memento_admin") {
    rows = await db.select().from(usersTable);
  } else {
    const callerAdminOrgs = await db
      .select({
        organizationId: userOrganizationsTable.organizationId,
      })
      .from(userOrganizationsTable)
      .where(
        and(
          eq(userOrganizationsTable.userId, caller.id),
          inArray(userOrganizationsTable.role, ["admin", "limited_admin"]),
        ),
      );
    const visibleOrgIds = callerAdminOrgs.map((r) => r.organizationId);
    if (visibleOrgIds.length === 0) {
      res.json([]);
      return;
    }
    const visibleUserIdRows = await db
      .selectDistinct({ userId: userOrganizationsTable.userId })
      .from(userOrganizationsTable)
      .where(
        inArray(userOrganizationsTable.organizationId, visibleOrgIds),
      );
    const visibleUserIds = visibleUserIdRows.map((r) => r.userId);
    if (visibleUserIds.length === 0) {
      res.json([]);
      return;
    }
    rows = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, visibleUserIds));
  }
  // Guest trial identities are not accounts: they are throwaway rows
  // reaped within hours, cannot be edited, assigned, or role-changed,
  // and would only be noise in user management. Filtering them here
  // also keeps the response valid — `AdminUser.role` deliberately does
  // not include `guest`, so a Memento Admin (whose branch above selects
  // every row) would otherwise get a 500 from `assertResponseShape`
  // whenever any guest session happened to be active.
  rows = rows.filter((u) => u.role !== "guest");
  rows.sort((a, b) => a.username.localeCompare(b.username));
  const memberships = await loadMembershipsForUsers(rows.map((r) => r.id));
  res.json(rows.map((u) => toAdminUser(u, memberships.get(u.id) ?? [])));
});

router.post(
  "/users/invite",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = InviteUserBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    if (!isIdpProvisioningEnabled()) {
      res.status(400).json({
        error:
          "IDP provisioning is not enabled on this server. " +
          "Set IDP_PROVISIONING_ENABLED=1 to turn it on.",
      });
      return;
    }
    const email = parsed.data.email.trim();
    const firstName = parsed.data.firstName?.trim() ?? "";
    const lastName = parsed.data.lastName?.trim() ?? "";
    if (!email || !EMAIL_RE.test(email)) {
      res
        .status(400)
        .json({ error: "Email is required and must be a valid address." });
      return;
    }
    if (!callerHasSsoAccessToken(req)) {
      res.status(403).json({ error: NO_SSO_TOKEN_MESSAGE });
      return;
    }
    const activeOrgId = req.session.activeOrgId;
    if (!activeOrgId) {
      res.status(403).json({ error: NO_ACTIVE_ORG_MESSAGE });
      return;
    }
    const [activeOrg] = await db
      .select({ externalKey: organizationsTable.externalKey })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, activeOrgId))
      .limit(1);
    if (!activeOrg?.externalKey) {
      res.status(403).json({ error: NO_ACTIVE_ORG_MESSAGE });
      return;
    }
    const provisioner = getIdpUserProvisioner();
    try {
      const result = await provisioner.inviteUser({
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        organizationId: activeOrg.externalKey,
        mementoOrgId: activeOrgId,
      });
      // Note: the invitation code is sensitive (a bearer-equivalent
      // registration token) and is intentionally NOT returned to the
      // admin — the recipient gets it in their email. memento only
      // surfaces the email + expiry. Audit lives in req.log for now;
      // adding a dedicated `user.invitation_sent` action enum value
      // would require a DB migration that's out of scope here.
      req.log.info(
        {
          email: result.email,
          expiresAt: result.expiresAt,
          activeOrgId,
          callerId: req.user!.id,
        },
        "IdP user invitation sent",
      );
      res
        .status(201)
        .json({ email: result.email, expiresAt: result.expiresAt });
      return;
    } catch (err) {
      if (err instanceof IdpNotConfiguredError) {
        res.status(503).json({ error: err.message });
        return;
      }
      if (err instanceof IdpInvitationConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `IDP invitation failed: ${msg}` });
      return;
    }
  },
);

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  const { role } = parsed.data;
  // Privilege-management policy: only an existing Memento Admin may
  // grant the Memento Admin (god-mode) role. Plain Admins (and Limited
  // Admins, who can't reach this route at all) cannot create another
  // Memento Admin.
  // Authorize on the *effective* (per-org) role — task #36. Memento
  // Admin lives exclusively on `users.role` (god-mode, org-independent)
  // and is preserved by the resolver. Using the resolver here means SSO
  // admins whose global column has been demoted to `limited` (per-org
  // foundation) still pass when they are admin in the active org.
  const callerEffective = (await getEffectiveRole(req)) ?? req.user!.role;
  if (role === "memento_admin" && callerEffective !== "memento_admin") {
    res.status(403).json({
      error: "Only a Memento Admin can grant the Memento Admin role.",
    });
    return;
  }
  const username = parsed.data.username.trim();
  const firstName = parsed.data.firstName?.trim() ?? "";
  const lastName = parsed.data.lastName?.trim() ?? "";
  const email = parsed.data.email?.trim() ?? "";
  const provisionInIdp = parsed.data.provisionInIdp === true;

  // For IDP-provisioned users the email doubles as the username — we
  // require both that the username be a valid email *and* that it
  // match the email field exactly. Local users keep the historic
  // character-set check so fork directories etc. stay compatible.
  if (provisionInIdp) {
    if (!EMAIL_RE.test(username)) {
      res.status(400).json({
        error:
          "Username must be a valid email address when provisioning in the identity provider.",
      });
      return;
    }
    if (email && email !== username) {
      res.status(400).json({
        error:
          "When provisioning in the identity provider, username and email must be identical.",
      });
      return;
    }
  } else if (!USERNAME_RE.test(username)) {
    res.status(400).json({
      error:
        "Username must be 3-40 characters and use letters, numbers, dot, dash, or underscore.",
    });
    return;
  }

  if (provisionInIdp) {
    if (!isIdpProvisioningEnabled()) {
      res.status(400).json({
        error:
          "IDP provisioning is not enabled on this server. " +
          "Set IDP_PROVISIONING_ENABLED=1 to turn it on.",
      });
      return;
    }
    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({
        error:
          "Email is required and must be a valid address when provisioning in the identity provider.",
      });
      return;
    }
    // NOTE: we intentionally do NOT pre-check for a local username
    // conflict here. In the link-existing-user path the local row for
    // the same email may already exist (e.g. the user signed in via
    // SSO under a different org first); blocking on it would prevent
    // legitimate cross-org link-and-reuse. The conflict is still
    // surfaced as 409 after Nexus lookup, when we can distinguish
    // "same person, reuse the row" from "different person, real
    // collision" by comparing `idpExternalId`.
    // Policy gate: only admins who signed in via SSO may provision
    // IDP users. The actual upstream call still uses the server-side
    // NEXUS_API_KEY, but we don't want local username/password admins
    // (seeded users, dev-login shortcut) to be able to create Nexus
    // accounts on someone else's tenant. Presence of an SSO access
    // token on the session (or a Bearer-validated Nexus token on the
    // request) is our proof that the caller authenticated through
    // Nexus. Token expiry doesn't matter for this gate — the user is
    // still SSO-authenticated as long as their session cookie is live.
    if (!callerHasSsoAccessToken(req)) {
      res.status(403).json({ error: NO_SSO_TOKEN_MESSAGE });
      return;
    }
    // The active org pins the Nexus tenant we provision into and
    // must match the API key's org scope.
    const activeOrgId = req.session.activeOrgId;
    if (!activeOrgId) {
      res.status(403).json({ error: NO_ACTIVE_ORG_MESSAGE });
      return;
    }
    // Nexus expects its own organization GUID, which memento stores in
    // `organizations.external_key` (the raw value of the org claim from
    // the IDP). Sending memento's internal UUID makes Nexus reply with
    // "400 Organization not found".
    const [activeOrg] = await db
      .select({ externalKey: organizationsTable.externalKey })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, activeOrgId))
      .limit(1);
    if (!activeOrg?.externalKey) {
      res.status(403).json({ error: NO_ACTIVE_ORG_MESSAGE });
      return;
    }
    // Look up the user in Nexus by email first. If they already exist
    // (typical when the same person has been added to a different org
    // in a previous flow), we link them to the active org via the
    // members endpoint instead of trying to create a duplicate — which
    // Nexus would reject with 409 "Email already exists" because the
    // email is the user's identity, not a per-org handle.
    const provisioner = getIdpUserProvisioner();
    let existing;
    try {
      existing = await provisioner.findUserByEmail(email, activeOrgId);
    } catch (err) {
      if (err instanceof IdpNotConfiguredError) {
        res.status(503).json({ error: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `IDP lookup failed: ${msg}` });
      return;
    }
    let externalId: string;
    let linkedExisting = false;
    let alreadyMember = false;
    if (existing) {
      // Link path. Use the per-org tier the admin picked in the Add
      // user dialog (mapped onto Nexus's org_admin/org_limited_admin/
      // org_member tiers). The Memento Admin god-mode role has no
      // per-org analogue in Nexus, so it collapses to org_admin.
      try {
        const linkResult = await provisioner.addUserToOrganization({
          externalId: existing.externalId,
          organizationId: activeOrg.externalKey,
          nexusRole: mementoRoleToIdpOrgRole(role),
          mementoOrgId: activeOrgId,
        });
        alreadyMember = linkResult.alreadyMember;
      } catch (err) {
        if (err instanceof IdpNotConfiguredError) {
          res.status(503).json({ error: err.message });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        res.status(502).json({ error: `IDP link failed: ${msg}` });
        return;
      }
      externalId = existing.externalId;
      linkedExisting = true;
    } else {
      // Create path. Nexus will send the welcome + verification email
      // and the user picks their own password via the nev_<hex> link.
      let result;
      try {
        result = await provisioner.createUser({
          username,
          role,
          firstName: firstName || null,
          lastName: lastName || null,
          email,
          // Omit password so Nexus runs in invitation-code mode and
          // emails the new user a welcome link they use to set their
          // own password. Sending a server-generated password trips
          // Nexus's breached-password check (HaveIBeenPwned).
          organizationId: activeOrg.externalKey,
          // Seed the user-gate claim that the SSO callback checks on
          // sign-in so the brand-new user can authenticate via SSO
          // immediately without an operator touching Nexus's admin UI.
          // The claim name comes from the same env var the SSO gate
          // reads so non-default deployments stay consistent.
          mementoUserClaimName:
            process.env.OIDC_MEMENTO_USER_CLAIM?.trim() || "mementoUser",
          mementoOrgId: activeOrgId,
        });
      } catch (err) {
        if (err instanceof IdpNotConfiguredError) {
          res.status(503).json({ error: err.message });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        // Per the Nexus partner doc, an empty lookup followed by a
        // 409 "Email already exists" on create means the email is on
        // file in Nexus but in a tenant/org the API key cannot see
        // (a "visibility miss"). The admin can't self-recover —
        // they need a higher-scoped key or a Nexus admin to act —
        // so we surface a clearer hint instead of just relaying the
        // raw Nexus reason.
        if (/email already exists/i.test(msg)) {
          res.status(409).json({
            error:
              "This email is already in use on the identity provider but in an organization this app's API key cannot see. Please ask an identity provider administrator to add the user to your organization.",
          });
          return;
        }
        res.status(502).json({ error: `IDP provisioning failed: ${msg}` });
        return;
      }
      externalId = result.externalId;
    }
    // Upsert the local memento row. For the link path the user may
    // already have a memento row (created when they signed in via SSO
    // for the first time under their original org) — in that case we
    // reuse it and just attach the per-org membership row below.
    // Otherwise we insert a fresh row stamped with the externalId so
    // the same row is reused on the user's first SSO sign-in (Nexus
    // uses the provision id as the OIDC `sub`).
    let mementoUser: User;
    const [existingLocal] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.idpExternalId, externalId))
      .limit(1);
    if (existingLocal) {
      mementoUser = existingLocal;
      // Backfill provisionedInOrgId on the link path for legacy rows
      // that don't yet carry it; harmless when already set because
      // `?? activeOrgId` only writes when null.
      if (!mementoUser.provisionedInOrgId) {
        const [updated] = await db
          .update(usersTable)
          .set({ provisionedInOrgId: activeOrgId })
          .where(eq(usersTable.id, mementoUser.id))
          .returning();
        if (updated) mementoUser = updated;
      }
    } else {
      // Defensive: a row may exist with this username but a different
      // (or null) idpExternalId — that's a genuine collision (a local
      // username/password account, or a stale row from a prior
      // failure). 409 with a clear message so the admin can resolve.
      const [usernameClash] = await db
        .select({ id: usersTable.id, idpExternalId: usersTable.idpExternalId })
        .from(usersTable)
        .where(eq(usersTable.username, username))
        .limit(1);
      if (usernameClash) {
        res.status(409).json({
          error:
            "A memento user with that username already exists but is not linked to the matching IDP account.",
        });
        return;
      }
      try {
        const [created] = await db
          .insert(usersTable)
          .values({
            username,
            passwordHash: null,
            role,
            firstName: firstName || null,
            lastName: lastName || null,
            email: email || null,
            profile: {},
            authSource: "oidc",
            oidcSubject: externalId,
            idpExternalId: externalId,
            // Record which memento org first provisioned this user so
            // future Nexus calls scoped to *this* user (notably the
            // resend-welcome route) can resolve the per-org partner
            // API key from the original tenant rather than guessing
            // from the caller's current active org.
            provisionedInOrgId: activeOrgId,
          })
          .returning();
        mementoUser = created!;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/unique|duplicate/i.test(msg)) {
          res.status(409).json({
            error:
              "A memento user is already linked to that IDP account or username.",
          });
          return;
        }
        throw err;
      }
    }
    // Make sure the per-org membership row exists so the new user
    // shows up in the active org's user list immediately (without
    // waiting for them to sign in via SSO to trigger the OIDC
    // provisioner's per-org sync).
    // `memento_admin` is god-mode and lives only on `users.role` — the
    // per-org enum doesn't include it, so collapse to `admin` for the
    // membership row (the org-level resolver still honors god-mode
    // separately via the users column).
    const orgRoleForMembership = role === "memento_admin" ? "admin" : role;
    try {
      await db
        .insert(userOrganizationsTable)
        .values({
          userId: mementoUser.id,
          organizationId: activeOrgId,
          role: orgRoleForMembership,
        })
        .onConflictDoNothing({
          target: [
            userOrganizationsTable.userId,
            userOrganizationsTable.organizationId,
          ],
        });
    } catch {
      // Best-effort — the SSO sync will reconcile on the user's next
      // sign-in. Don't fail the whole request if the membership row
      // can't be written.
    }
    const memberships = await loadMembershipsForUser(mementoUser.id);
    res.status(201).json({
      user: toAdminUser(mementoUser, memberships),
      temporaryPassword: null,
      provisionedInIdp: true,
      idpExternalId: externalId,
      linkedExistingIdpUser: linkedExisting,
      alreadyMemberOfOrg: alreadyMember,
    });
    return;
  }

  const [conflict] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);
  if (conflict) {
    res.status(409).json({ error: "Username is already taken." });
    return;
  }

  const passwordHash = await hashPassword(TEMPORARY_PASSWORD);
  let created;
  try {
    [created] = await db
      .insert(usersTable)
      .values({
        username,
        passwordHash,
        role,
        firstName: firstName || null,
        lastName: lastName || null,
        profile: {},
      })
      .returning();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(msg)) {
      res.status(409).json({ error: "Username is already taken." });
      return;
    }
    throw err;
  }

  res.status(201).json({
    user: toAdminUser(created),
    temporaryPassword: TEMPORARY_PASSWORD,
  });
});

router.patch("/users/:id", requireAnyAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  const data = parsed.data;
  const hasProfileField =
    data.firstName !== undefined ||
    data.lastName !== undefined ||
    data.title !== undefined ||
    data.email !== undefined;

  // Global-path role guard (must run BEFORE any DB lookup keyed by
  // `id` — that lookup will throw on a non-UUID id and surface as a
  // 500 to the caller, masking the real authorization failure).
  // limited_admin is an org-scoped role: it may only mutate per-org
  // memberships via the orgId branch below. Any attempt to touch the
  // global `users.role` column or profile fields must be rejected up
  // front with a 403, regardless of whether the target user exists.
  if (data.orgId === undefined) {
    const callerRole = req.user!.role;
    const attemptsGlobalMutation =
      data.role !== undefined || hasProfileField;
    if (
      attemptsGlobalMutation &&
      callerRole !== "admin" &&
      callerRole !== "memento_admin"
    ) {
      res.status(403).json({
        error:
          "Only global Admins can edit a user's profile or global role. Use the per-organization edit (include orgId) for org-scoped role changes.",
      });
      return;
    }
  }

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // ----- Per-org role edit path -----
  // When the caller specifies `orgId`, the role change applies to the
  // target user's `user_organizations` row for that org instead of the
  // global `users.role` column. memento_admin is org-independent and
  // is never a valid per-org role.
  if (data.orgId !== undefined) {
    const orgId = data.orgId;
    if (data.role === undefined) {
      res.status(400).json({
        error: "A role is required when editing a per-organization membership.",
      });
      return;
    }
    if (data.role === "memento_admin") {
      res.status(400).json({
        error:
          "Memento Admin is a global role; omit orgId to grant or revoke it.",
      });
      return;
    }
    if (existing.authSource !== "oidc") {
      res.status(400).json({
        error:
          "This user is a local username/password account and has no per-organization memberships. Edit the global role instead (omit orgId).",
      });
      return;
    }

    // Authorization: only an admin within the target org may edit
    // memberships within it. Memento Admin sails through any org.
    const caller = req.user!;
    if (caller.role !== "memento_admin") {
      const [callerMembership] = await db
        .select({ role: userOrganizationsTable.role })
        .from(userOrganizationsTable)
        .where(
          and(
            eq(userOrganizationsTable.userId, caller.id),
            eq(userOrganizationsTable.organizationId, orgId),
          ),
        )
        .limit(1);
      const callerOrgRole = callerMembership?.role ?? null;
      if (callerOrgRole !== "admin" && callerOrgRole !== "limited_admin") {
        res.status(403).json({
          error:
            "You can only edit member roles in an organization you administer.",
        });
        return;
      }
    }

    // The target must already be a member of the org — admins cannot
    // synthesize memberships from this endpoint (IDP is the source of
    // truth for who belongs to which org).
    const [targetMembership] = await db
      .select({ role: userOrganizationsTable.role })
      .from(userOrganizationsTable)
      .where(
        and(
          eq(userOrganizationsTable.userId, id),
          eq(userOrganizationsTable.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!targetMembership) {
      res.status(404).json({
        error: "That user is not a member of the requested organization.",
      });
      return;
    }

    if (targetMembership.role !== data.role) {
      // Org-scoped orphan guard: don't leave an org with zero admins.
      if (
        targetMembership.role === "admin" &&
        (data.role === "limited" || data.role === "limited_admin")
      ) {
        const otherOrgAdmins = await db
          .select({ id: userOrganizationsTable.id })
          .from(userOrganizationsTable)
          .where(
            and(
              eq(userOrganizationsTable.organizationId, orgId),
              eq(userOrganizationsTable.role, "admin"),
              ne(userOrganizationsTable.userId, id),
            ),
          );
        if (otherOrgAdmins.length === 0) {
          res.status(400).json({
            error: "Cannot demote the last remaining admin of this organization.",
          });
          return;
        }
      }
      await db
        .update(userOrganizationsTable)
        .set({ role: data.role })
        .where(
          and(
            eq(userOrganizationsTable.userId, id),
            eq(userOrganizationsTable.organizationId, orgId),
          ),
        );
    }

    const memberships = await loadMembershipsForUser(id);
    res.json(toAdminUser(existing, memberships));
    return;
  }

  // ----- Global role + profile edit path -----
  // The "only global Admins" guard for global-path mutations runs
  // earlier (before the DB lookup) so a non-UUID id can't crash the
  // query and mask the 403.

  const updates: Partial<typeof usersTable.$inferInsert> = {};

  if (data.role !== undefined && data.role !== existing.role) {
    // Per-org-roles policy: SSO users' authority comes from their
    // memberships, not the global `users.role` column. The only
    // global role change allowed for SSO users is promoting them to,
    // or demoting them from, the god-mode `memento_admin` role.
    // Anything else must go through the per-org path so the change
    // actually takes effect.
    if (
      existing.authSource === "oidc" &&
      data.role !== "memento_admin" &&
      existing.role !== "memento_admin"
    ) {
      res.status(400).json({
        error:
          "This user signs in via SSO; their role within an organization must be edited per-org (include orgId).",
      });
      return;
    }
    // Privilege-management policy: only an existing Memento Admin may
    // grant or revoke the Memento Admin (god-mode) role.
    // Authorize on the *effective* (per-org) role — task #36. Memento
    // Admin lives on `users.role` (god-mode) and is preserved by the
    // resolver, so this still correctly only admits actual god-mode
    // callers — not SSO admins with `users.role = 'limited'`.
    const callerEffective = (await getEffectiveRole(req)) ?? req.user!.role;
    if (
      (data.role === "memento_admin" || existing.role === "memento_admin") &&
      callerEffective !== "memento_admin"
    ) {
      res.status(403).json({
        error: "Only a Memento Admin can grant or revoke the Memento Admin role.",
      });
      return;
    }
    // Orphan guard: at least one Admin or Memento Admin must remain.
    // Memento Admin counts as an admin for this check because it's a
    // god-mode superset of Admin.
    if (
      (existing.role === "admin" || existing.role === "memento_admin") &&
      (data.role === "limited" || data.role === "limited_admin")
    ) {
      const otherAdmins = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            inArray(usersTable.role, ["admin", "memento_admin"]),
            ne(usersTable.id, id),
          ),
        );
      if (otherAdmins.length === 0) {
        res
          .status(400)
          .json({ error: "Cannot demote the last remaining admin." });
        return;
      }
    }
    updates.role = data.role;
  }

  if (hasProfileField) {
    const firstName = (data.firstName ?? existing.firstName ?? "").trim();
    const lastName = (data.lastName ?? existing.lastName ?? "").trim();
    const title = (data.title ?? existing.title ?? "").trim();
    const email = (data.email ?? existing.email ?? "").trim();
    if (
      !firstName ||
      !lastName ||
      !title ||
      !email ||
      !EMAIL_RE.test(email)
    ) {
      res.status(400).json({
        error: "All profile fields are required and email must be valid.",
      });
      return;
    }
    updates.firstName = firstName;
    updates.lastName = lastName;
    updates.title = title;
    updates.email = email;
  }

  if (Object.keys(updates).length === 0) {
    const memberships = await loadMembershipsForUser(id);
    res.json(toAdminUser(existing, memberships));
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const memberships = await loadMembershipsForUser(id);
  res.json(toAdminUser(updated, memberships));
});

router.delete("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
  const callerId = req.user!.id;

  if (id === callerId) {
    res
      .status(400)
      .json({ error: "You cannot delete your own account." });
    return;
  }

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Privilege-management policy: only an existing Memento Admin may
  // remove a Memento Admin (god-mode role).
  // Authorize on the *effective* (per-org) role — task #36.
  const callerEffective = (await getEffectiveRole(req)) ?? req.user!.role;
  if (
    existing.role === "memento_admin" &&
    callerEffective !== "memento_admin"
  ) {
    res.status(403).json({
      error: "Only a Memento Admin can delete a Memento Admin.",
    });
    return;
  }

  // Orphan guard: at least one Admin or Memento Admin must remain.
  if (existing.role === "admin" || existing.role === "memento_admin") {
    const otherAdmins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          inArray(usersTable.role, ["admin", "memento_admin"]),
          ne(usersTable.id, id),
        ),
      );
    if (otherAdmins.length === 0) {
      res
        .status(400)
        .json({ error: "Cannot delete the last remaining admin." });
      return;
    }
  }

  try {
    const deleted = await db
      .delete(usersTable)
      .where(eq(usersTable.id, id))
      .returning({ id: usersTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/foreign key|violates/i.test(msg)) {
      res.status(409).json({
        error:
          "This user has issued project assignments to other people. " +
          "Reassign or remove those assignments first.",
      });
      return;
    }
    throw err;
  }

  await recordAudit({
    user: { id: callerId },
    action: "user_delete",
    details: {
      deletedUserId: existing.id,
      deletedUsername: existing.username,
      deletedRole: existing.role,
    },
  });

  res.status(204).end();
});

router.post(
  "/users/:id/resend-welcome",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = String(req.params.id ?? "");
    if (!isIdpProvisioningEnabled()) {
      res.status(400).json({
        error:
          "IDP provisioning is not enabled on this server. " +
          "Set IDP_PROVISIONING_ENABLED=1 to turn it on.",
      });
      return;
    }
    const [target] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (!target.idpExternalId) {
      res.status(400).json({
        error:
          "This user was not provisioned through the identity provider, " +
          "so there is no welcome email to resend.",
      });
      return;
    }
    // Same SSO-only policy as POST /users (provisionInIdp): a local
    // admin cannot trigger a Nexus welcome-email resend.
    if (!callerHasSsoAccessToken(req)) {
      res.status(403).json({ error: NO_SSO_TOKEN_MESSAGE });
      return;
    }
    // The active-org check still applies — memento pins every Nexus
    // call to the calling admin's current org so an admin scoped to
    // org A cannot resend a welcome email for a user that belongs to
    // org B by spoofing the user id in the URL.
    if (!req.session.activeOrgId) {
      res.status(403).json({ error: NO_ACTIVE_ORG_MESSAGE });
      return;
    }
    try {
      // Prefer the org the user was originally provisioned in (so the
      // per-org Nexus partner key from *that* tenant is used) and
      // fall back to the caller's active org for legacy users whose
      // `provisioned_in_org_id` wasn't recorded yet.
      const resendOrgId =
        target.provisionedInOrgId ?? req.session.activeOrgId ?? null;
      const result = await getIdpUserProvisioner().resendWelcome(
        target.idpExternalId,
        resendOrgId,
      );
      res.status(200).json({
        message: result.message,
        lastResentAt: result.lastResentAt,
        resendCount: result.resendCount,
      });
      return;
    } catch (err) {
      if (err instanceof IdpThrottledError) {
        if (err.retryAfterSeconds != null) {
          res.setHeader("Retry-After", String(err.retryAfterSeconds));
        }
        res.status(429).json({
          error: err.message,
          retryAfterSeconds: err.retryAfterSeconds,
          lastResentAt: err.lastResentAt,
          resendCount: err.resendCount,
        });
        return;
      }
      if (err instanceof IdpUserNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof IdpNotConfiguredError) {
        res.status(503).json({ error: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `IDP resend failed: ${msg}` });
      return;
    }
  },
);

export default router;

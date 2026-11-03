import { Router, type IRouter } from "express";
import { and, eq, or, sql } from "drizzle-orm";
import {
  db,
  organizationsTable,
  userOrganizationsTable,
  usersTable,
  type User,
  isProfileComplete,
} from "@workspace/db";
import {
  LoginBody,
  LoginResponse as LoginResultSchema,
  RequestPasswordResetResponse,
  UpdateProfileBody,
  UpdateProfileResponse,
} from "@workspace/api-zod";
import { assertResponseShape } from "@/shared/assertResponseShape";
import { getAuthProvider } from "@/features/auth/infrastructure/authProvider";
import { getContainer } from "@/composition/container";
import { ExpressSessionStore } from "@/features/auth/infrastructure/adapters";
import { httpStatusForAppError } from "@workspace/kernel";
import { logger } from "@/shared/logger";
import {
  emailTriggerRateLimit,
  loginRateLimit,
} from "@/shared/middlewares/rateLimit";
import { isDevEnvironment } from "@/features/auth/infrastructure/devEnvironment";
import {
  countForgotPasswordUrlOverrides,
  getForgotPasswordUrlOverride,
  runWithPasswordResetRequestContext,
  setForgotPasswordUrlOverride,
} from "@/features/auth/infrastructure/nexusPasswordResetClient";
import {
  getOidcConfig,
  isOidcEnabled,
} from "@/features/auth/infrastructure/oidcConfig";
import { normalizeLoginHint } from "@/features/auth/infrastructure/loginHint";
import { isIdpProvisioningEnabled } from "@/features/users/infrastructure/idpProvisioner";
import {
  clearCurrentProjectForUser,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import { recordSsoDenial } from "@/features/sso-denials/infrastructure/ssoDenialService";
import { getNexusIdpConfig } from "@/features/users/infrastructure/nexusIdpProvisioner";
import {
  buildAuthorizationUrl,
  buildEndSessionUrl,
  listOrgsForUser,
  listOrgsWithRolesForUser,
  makePkce,
  makeState,
  refreshAccessToken,
} from "@/features/auth/infrastructure/oidcProvider";
import { resolveEffectiveRoleFromMemberships } from "@/features/auth/domain/effectiveRole";
import { findActiveGuestSession } from "@/features/guest/infrastructure/guestSessionService";
import type { Request, Response, NextFunction } from "express";

const router: IRouter = Router();

/**
 * Read the stub-token header used to scope dev-only forgot-password
 * URL overrides. Token `""` (the default slot) is reserved for the
 * no-header case so concurrent specs that each pass a unique token
 * are guaranteed not to collide.
 */
function readStubToken(req: Request): string {
  const raw = req.header("x-nexus-stub-token");
  if (typeof raw !== "string") return "";
  return raw.trim();
}


function toPublicUser(
  user: User,
  effectiveRole?: User["role"] | null,
  /**
   * Hard-delete deadline for guest ("Continue as guest") trial
   * identities, ISO-8601. Null for every real account. Surfaced on
   * `/auth/me` so the SPA can render the countdown banner without a
   * second round-trip.
   */
  guestExpiresAt?: string | null,
) {
  return {
    guestExpiresAt: guestExpiresAt ?? null,
    id: user.id,
    username: user.username,
    role: user.role,
    // Resolved memento role for the current active org. Callers that
    // omit the argument (login / profile responses, which don't know
    // the active org) get a sensible default of `user.role` so the
    // pre-task shape is preserved for local users. Callers that pass
    // an *explicit* `null` (`/auth/me` for an SSO user with no active
    // org or no matching membership) must see that null propagate to
    // the wire so the UI can treat the request as unauthorized — the
    // distinction between "omitted" and "explicit null" matters and
    // `??` would silently collapse them.
    effectiveRole:
      effectiveRole === undefined ? user.role : effectiveRole,
    firstName: user.firstName,
    lastName: user.lastName,
    title: user.title,
    email: user.email,
    profileComplete: isProfileComplete(user),
    authSource: user.authSource,
  };
}

/**
 * Where to send the browser after SSO completes. Defaults to the
 * test-builder root so the SPA's AuthGate can pick the right onboarding
 * landing (splash → profile-complete → home, or pick-org).
 */
function ssoPostLoginRedirect(): string {
  return process.env.OIDC_POST_LOGIN_REDIRECT?.trim() || "/";
}

/**
 * Refresh the OIDC access token in-place when it's about to expire.
 * Runs before any handler that touches the IDP-derived session state
 * (currently `/auth/me`). For local users — anyone without an
 * `oidcRefreshToken` on the session — this is a no-op so the existing
 * username/password flow is unchanged.
 *
 * On a successful refresh, the rotated `access_token`, optional new
 * `refresh_token`, and the new `expires_at` are written back to the
 * session. On an unrecoverable failure (the IDP returns 4xx, meaning
 * the refresh token has been revoked or expired) the local session
 * is destroyed so the next request forces a fresh sign-in instead of
 * silently running with stale claims.
 */
export async function refreshOidcSessionIfNeeded(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const refreshToken = req.session.oidcRefreshToken;
  if (!refreshToken) {
    next();
    return;
  }
  const expiresAt = req.session.oidcAccessTokenExpiresAt ?? 0;
  // Refresh 60s early so an in-flight request never trips on an
  // already-expired token at the IDP.
  if (expiresAt - 60_000 > Date.now()) {
    next();
    return;
  }
  try {
    const refreshed = await refreshAccessToken(refreshToken);
    req.session.oidcAccessToken = refreshed.access_token;
    if (refreshed.refresh_token) {
      // Persist rotation: many IDPs (Nexus included) issue a new
      // refresh token on every grant and revoke the previous one.
      req.session.oidcRefreshToken = refreshed.refresh_token;
    }
    if (typeof refreshed.expires_in === "number") {
      req.session.oidcAccessTokenExpiresAt =
        Date.now() + refreshed.expires_in * 1000;
    }
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );
    next();
  } catch (err) {
    logger.warn({ err }, "OIDC refresh failed; clearing session");
    // Drop the dead session but DO NOT 401 the response. Routes mounted
    // behind this middleware (notably `/auth/me`) are status probes
    // that the SPA relies on to discover server-side flags like
    // `ssoEnabled` even when the caller is anonymous. 401-ing here
    // caused the SPA's auth-context catch block to leave `ssoEnabled`
    // at its initial `false`, which made the login page falsely
    // report "SSO sign-in isn't configured for this server" the
    // moment a user typed an email. Clear the cookie + session and
    // let the handler run as anonymous; it will return `user: null`
    // alongside the correct `ssoEnabled: true`.
    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        logger.error({ err: destroyErr }, "Failed to destroy session");
      }
      res.clearCookie("tb.sid", { path: "/" });
      next();
    });
  }
}

router.post("/auth/login", ...loginRateLimit, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { username, password } = parsed.data;
  const result = await getContainer().useCases.auth.signInLocal.execute({
    username,
    password,
    session: new ExpressSessionStore(req),
  });
  if (result.kind === "err") {
    res.status(httpStatusForAppError(result.error)).json({
      error: result.error.message,
    });
    return;
  }
  const user = result.value.user;
  // Fresh login starts with no pinned project so post-login routing is
  // deterministic regardless of any leftover in-memory state.
  setCurrentProject(null, user.id);

  logger.info({ username: user.username }, "User logged in");
  res.json(LoginResultSchema.parse({ user: toPublicUser(user) }));
});

/**
 * Dev-only fast user switch. Disabled (404) outside `local` / `development`
 * environments. Useful for Replit testing.
 */
router.get("/auth/dev-login", async (req, res): Promise<void> => {
  if (!isDevEnvironment()) {
    res.status(404).end();
    return;
  }
  const email = String(req.query.email ?? "").trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: "email query parameter is required." });
    return;
  }
  const queryRole = String(req.query.role ?? "").trim().toLowerCase();
  const inferredRole:
    | "memento_admin"
    | "admin"
    | "limited"
    | "limited_admin" =
    queryRole === "memento_admin" ||
    queryRole === "admin" ||
    queryRole === "limited" ||
    queryRole === "limited_admin"
      ? (queryRole as
          | "memento_admin"
          | "admin"
          | "limited"
          | "limited_admin")
      : email.startsWith("memento.admin") || email.includes("memento_admin")
        ? "memento_admin"
        : email.includes("admin")
          ? "admin"
          : "limited";

  // Look up by username OR email (case-insensitive on both) so the
  // seeded users (whose username is `AdminRole` / `LimitedAdminRole`
  // / `UserRole` and whose email matches what the harness sends) get
  // re-used instead of being shadowed by a freshly-inserted empty
  // profile every time.
  const existing = await db
    .select()
    .from(usersTable)
    .where(
      or(
        sql`lower(${usersTable.username}) = ${email}`,
        sql`lower(${usersTable.email}) = ${email}`,
      ),
    )
    .limit(1);

  // Optional dev-only org scoping. When `?org=<externalKey>` is
  // present, the dev-login pretends the caller is an SSO user inside
  // that org so org-scoped flows (project-lifecycle approvals, the
  // sole-admin probe, etc.) become exercisable from e2e specs without
  // standing up a real IDP. Each unique `org` value gets its own
  // ephemeral `organizations` row, so specs that pass a per-suite
  // value (e.g. `e2e_lifecycle_<ts>`) automatically get a clean
  // single-admin tenant: the sole admin in that org is deterministic.
  const orgParam = String(req.query.org ?? "").trim();
  if (orgParam && inferredRole === "memento_admin") {
    res.status(400).json({
      error:
        "memento_admin is org-independent; do not combine it with ?org=<key>.",
    });
    return;
  }
  // For org-scoped dev-logins we mark the user as OIDC-provisioned so
  // `resolveScopePolicy` returns `{kind:"org"}` and `getEffectiveRole`
  // reads the per-org membership role. The global `users.role` column
  // is pinned to `limited` to match the SSO convention (post-task #36
  // SSO admins carry the global column as `limited` and live by their
  // per-org membership).
  const persistedAuthSource: "local" | "oidc" = orgParam ? "oidc" : "local";
  const persistedRole = orgParam ? "limited" : inferredRole;

  let user: User;
  if (existing[0]) {
    const [updated] = await db
      .update(usersTable)
      .set({
        role: persistedRole,
        authSource: persistedAuthSource,
        email,
        lastLoginAt: new Date(),
        loginCount: (existing[0].loginCount ?? 0) + 1,
      })
      .where(eq(usersTable.id, existing[0].id))
      .returning();
    user = updated!;
  } else {
    const [created] = await db
      .insert(usersTable)
      .values({
        username: email,
        passwordHash: null,
        role: persistedRole,
        authSource: persistedAuthSource,
        email,
        loginCount: 1,
        lastLoginAt: new Date(),
        profile: {},
      })
      .returning();
    user = created!;
  }

  let activeOrgId: string | null = null;
  if (orgParam) {
    // Find-or-create the org by externalKey. Display name defaults to
    // the key so the row is readable in Admin → Organizations even
    // though it was created by a dev shortcut.
    const existingOrg = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.externalKey, orgParam))
      .limit(1);
    let orgRow = existingOrg[0];
    if (!orgRow) {
      const [created] = await db
        .insert(organizationsTable)
        .values({ externalKey: orgParam, displayName: orgParam })
        .returning();
      orgRow = created!;
    }
    activeOrgId = orgRow.id;
    // Map the requested global role onto the per-org enum (which
    // forbids memento_admin — guarded above).
    const membershipRole: "admin" | "limited_admin" | "limited" =
      inferredRole === "admin"
        ? "admin"
        : inferredRole === "limited_admin"
          ? "limited_admin"
          : "limited";
    const existingMembership = await db
      .select()
      .from(userOrganizationsTable)
      .where(
        and(
          eq(userOrganizationsTable.userId, user.id),
          eq(userOrganizationsTable.organizationId, orgRow.id),
        ),
      )
      .limit(1);
    if (existingMembership[0]) {
      await db
        .update(userOrganizationsTable)
        .set({ role: membershipRole })
        .where(eq(userOrganizationsTable.id, existingMembership[0].id));
    } else {
      await db.insert(userOrganizationsTable).values({
        userId: user.id,
        organizationId: orgRow.id,
        role: membershipRole,
        idpRole: `dev-login:${membershipRole}`,
      });
    }
  }

  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
  req.session.userId = user.id;
  if (activeOrgId) {
    req.session.activeOrgId = activeOrgId;
  }
  // E2E support (dev-only): `?sso=1` stamps the session with a
  // synthetic OIDC access token so policy gates that require "caller
  // signed in via SSO" (e.g. `POST /api/users/invite`) become
  // exercisable from Playwright without standing up a real Nexus
  // sign-in. The token value itself is opaque — the SSO gate checks
  // presence, not signature — and the gate is already restricted to
  // `isDevEnvironment()` upstream. Pairs with `?org=<key>` so the
  // session also carries an active org (required by the same route).
  const ssoParam = String(req.query.sso ?? "").trim().toLowerCase();
  if (ssoParam === "1" || ssoParam === "true" || ssoParam === "yes") {
    req.session.oidcAccessToken = "e2e-fake-sso-token";
    // 1h fake expiry, far enough out that long suites don't trip it.
    req.session.oidcAccessTokenExpiresAt = Date.now() + 60 * 60 * 1000;
  }
  await new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  res.json({ user: toPublicUser(user) });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const userId = req.user?.id ?? req.session.userId ?? null;
  try {
    await getContainer().useCases.auth.signOut.execute({
      userId,
      session: new ExpressSessionStore(req),
    });
  } catch (err) {
    logger.error({ err }, "Failed to destroy session");
    res.status(500).json({ error: "Failed to log out" });
    return;
  }
  // M-4/M-3: drop this user's cached active project. The in-memory map
  // previously only shed entries on explicit unload, project delete or
  // assignment revocation, so a signed-out user left a full `Project`
  // object behind for the process lifetime. Clearing here also means the
  // next sign-in starts from a deterministic "no project loaded" state.
  if (userId) clearCurrentProjectForUser(userId);
  res.clearCookie("tb.sid", { path: "/" });
  res.status(204).end();
});

/**
 * Compute the IDP end-session URL for the *current* SSO session, if
 * any. The SPA calls this immediately before `POST /auth/logout` so
 * it can sign the user out of Nexus too. Returns
 * `{ endSessionUrl: null }` for local users or when the IDP doesn't
 * advertise an end_session endpoint, in which case the SPA falls back
 * to local-only logout.
 *
 * This is a separate read endpoint (rather than baking the URL into
 * the logout response) so the existing logout contract — 204 No
 * Content — stays intact for the generated API client.
 */
router.get("/auth/sso/end-session-url", async (req, res): Promise<void> => {
  const idTokenHint = req.session.oidcIdToken;
  if (!isOidcEnabled() || !idTokenHint) {
    res.json({ endSessionUrl: null });
    return;
  }
  try {
    const cfg = getOidcConfig()!;
    const origin =
      req.get("origin") ??
      `${req.protocol}://${req.get("host") ?? "localhost"}`;
    // Build a fallback post-logout URL by URL-joining the configured
    // `OIDC_POST_LOGIN_REDIRECT` base path with `logged-out` so the
    // user lands on memento's post-logout confirmation page. Plain
    // string concat would produce `/applogged-out` when the base is
    // `/app`; the `URL` constructor + explicit trailing slash gives
    // us the expected `/app/logged-out`.
    const base = ssoPostLoginRedirect();
    const baseWithSlash = base.endsWith("/") ? base : `${base}/`;
    const postLogout =
      cfg.postLogoutRedirectUrl ??
      new URL("logged-out", new URL(baseWithSlash, origin)).toString();
    const url = await buildEndSessionUrl({
      idTokenHint,
      postLogoutRedirectUrl: postLogout,
    });
    res.json({ endSessionUrl: url });
  } catch (err) {
    logger.warn({ err }, "Failed to build IDP end-session URL");
    res.json({ endSessionUrl: null });
  }
});

/**
 * Tell the SPA where the OIDC flow wants the user to land after a
 * successful sign-in. The org-picker page reads this and uses it
 * (instead of a hard-coded "/") so that operators who set
 * `OIDC_POST_LOGIN_REDIRECT` to a non-default landing path get the
 * same destination whether the user has one org (auto-selected
 * server-side) or multiple (picked client-side).
 */
router.get("/auth/sso/post-login-redirect", (_req, res): void => {
  res.json({ postLoginRedirect: ssoPostLoginRedirect() });
});

/**
 * Look up admin contacts for a single org (identified by its IDP
 * `externalKey`). Used by the unauthenticated `/auth/sso/admin-contacts`
 * endpoint so the SSO deny banners on `/login` can tell a denied user
 * who to ask for access.
 *
 * Returns at most 5 admins ordered by username for a stable list. Only
 * users with `role='admin'` AND an `email` are returned — memento
 * admins are intentionally excluded (they are a god-mode super role
 * that is not org-bound, so they are not the right "ask for access"
 * contact for any specific org).
 */
async function lookupOrgAdminContacts(
  externalKey: string,
): Promise<{
  org: { externalKey: string; displayName: string } | null;
  admins: { email: string; displayName: string }[];
}> {
  const [orgRow] = await db
    .select({
      id: organizationsTable.id,
      externalKey: organizationsTable.externalKey,
      displayName: organizationsTable.displayName,
    })
    .from(organizationsTable)
    .where(eq(organizationsTable.externalKey, externalKey))
    .limit(1);
  if (!orgRow) return { org: null, admins: [] };

  const rows = await db
    .select({
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      username: usersTable.username,
    })
    .from(usersTable)
    .innerJoin(
      userOrganizationsTable,
      eq(userOrganizationsTable.userId, usersTable.id),
    )
    .where(
      and(
        eq(userOrganizationsTable.organizationId, orgRow.id),
        eq(usersTable.role, "admin"),
      ),
    )
    .orderBy(usersTable.username)
    .limit(20);

  const seen = new Set<string>();
  const admins: { email: string; displayName: string }[] = [];
  for (const r of rows) {
    const email = (r.email ?? "").trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    const name = [r.firstName ?? "", r.lastName ?? ""]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ");
    admins.push({
      email,
      displayName: name || r.username,
    });
    if (admins.length >= 5) break;
  }

  return {
    org: { externalKey: orgRow.externalKey, displayName: orgRow.displayName },
    admins,
  };
}

/**
 * Unauthenticated lookup of admin contacts for an org. Backs the
 * SSO deny banners on `/login` so a user who gets denied at the
 * claim gates can see "ask <admin email> for access" instead of a
 * dead-end "contact your administrator" message.
 *
 * `org` is the IDP `externalKey` — the same value the SSO callback
 * appends to the deny redirect as `&org=…`. Missing / unknown keys
 * return an empty payload (with a generic `{org:null, admins:[]}`)
 * so the SPA can fall back to the generic copy without a 404 noise.
 */
router.get("/auth/sso/admin-contacts", async (req, res): Promise<void> => {
  const raw = typeof req.query.org === "string" ? req.query.org.trim() : "";
  if (!raw) {
    res.json({ org: null, admins: [] });
    return;
  }
  try {
    const result = await lookupOrgAdminContacts(raw);
    res.json(result);
  } catch (err) {
    req.log.warn({ err }, "Failed to look up SSO admin contacts");
    res.json({ org: null, admins: [] });
  }
});

router.get("/auth/me", refreshOidcSessionIfNeeded, async (req, res): Promise<void> => {
  // Prefer a bearer-authenticated user (the bearer middleware already
  // verified the Nexus token and provisioned the row). Fall back to
  // the session cookie for browser callers.
  const userId = req.user?.id ?? req.session.userId;
  if (!userId) {
    res.json({
      user: null,
      organizations: [],
      activeOrganizationId: null,
      ssoEnabled: isOidcEnabled(),
      idpProvisioningEnabled: isIdpProvisioningEnabled(),
      canProvisionInIdp: false,
    });
    return;
  }
  const user = req.user ?? (await getAuthProvider().findUserById(userId));
  if (!user) {
    res.json({
      user: null,
      organizations: [],
      activeOrganizationId: null,
      ssoEnabled: isOidcEnabled(),
      idpProvisioningEnabled: isIdpProvisioningEnabled(),
      canProvisionInIdp: false,
    });
    return;
  }
  // Org list is empty for local users (they never have user_organizations
  // rows). For IDP users it reflects the most recent IDP claim sync.
  // Pulls the per-org `role` alongside the org so the SPA can render
  // "Admin in OrgA, Limited Admin in OrgB" without a second round-trip.
  const orgsWithRoles = await listOrgsWithRolesForUser(user.id);
  const orgs = orgsWithRoles.map((r) => r.org);
  // Drop any stale active-org pointer that no longer maps to a current
  // membership (the IDP could have revoked the org since last login).
  let activeOrgId = req.session.activeOrgId ?? null;
  if (activeOrgId && !orgs.some((o) => o.id === activeOrgId)) {
    activeOrgId = null;
    req.session.activeOrgId = null;
  }
  // Resolve the *effective* role for the currently-active org. Memento
  // admins and local users short-circuit; SSO users resolve through the
  // matching membership row. The pre-loaded membership list lets us
  // skip a second DB round-trip.
  const effectiveRole = resolveEffectiveRoleFromMemberships(
    user,
    activeOrgId,
    orgsWithRoles.map((r) => ({
      organizationId: r.org.id,
      role: r.role,
    })),
  );
  // Policy: only admins who signed in via SSO may provision IDP
  // users. The actual upstream call uses the server-side
  // NEXUS_API_KEY, but the gate prevents local username/password
  // admins (seeded users, dev-login) from creating Nexus accounts on
  // someone else's tenant. Presence of an SSO access token on the
  // session (or a Bearer-validated Nexus token on this request) is
  // our proof of SSO sign-in. Local admins → false.
  const hasSsoAccessToken = Boolean(
    req.nexusAccessToken || req.session.oidcAccessToken,
  );
  const nexusKeyConfigured = getNexusIdpConfig() !== null;
  // Authority check uses the *resolved* effective role — task #35.
  // SSO users no longer carry their org authority on `users.role`
  // (which is `limited` for everyone but Memento Admins), so reading
  // the global column here would silently demote every org admin.
  const canProvisionInIdp =
    isIdpProvisioningEnabled() &&
    (effectiveRole === "admin" || effectiveRole === "memento_admin") &&
    nexusKeyConfigured &&
    hasSsoAccessToken &&
    Boolean(activeOrgId);
  // Guests carry a hard deadline rather than an org. One extra lookup,
  // and only for guests.
  const guestSession =
    user.role === "guest" ? await findActiveGuestSession(user.id) : null;
  res.json({
    user: toPublicUser(
      user,
      effectiveRole,
      guestSession ? guestSession.expiresAt.toISOString() : null,
    ),
    organizations: orgsWithRoles.map((r) => ({
      id: r.org.id,
      externalKey: r.org.externalKey,
      displayName: r.org.displayName,
      role: r.role,
    })),
    activeOrganizationId: activeOrgId,
    ssoEnabled: isOidcEnabled(),
    idpProvisioningEnabled: isIdpProvisioningEnabled(),
    canProvisionInIdp,
  });
});

/**
 * Switch the active organization. IDP users only — local users don't
 * carry an active org. Returns 400 if the user isn't a member of the
 * requested org so a stale or forged id can't widen visibility.
 */
router.post("/auth/active-org", async (req, res): Promise<void> => {
  const userId = req.user?.id ?? req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const orgId = typeof req.body?.organizationId === "string"
    ? req.body.organizationId
    : null;
  if (!orgId) {
    res.status(400).json({ error: "organizationId is required" });
    return;
  }
  const orgs = await listOrgsForUser(userId);
  const match = orgs.find((o) => o.id === orgId);
  if (!match) {
    res.status(400).json({ error: "You are not a member of that organization" });
    return;
  }
  req.session.activeOrgId = match.id;
  await new Promise<void>((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );
  res.json({ activeOrganizationId: match.id });
});

/**
 * Begin the OIDC authorization-code + PKCE flow. Generates a fresh
 * `state` and `code_verifier`, parks them on the session, and 302s
 * the browser to the IDP. Returns 404 when SSO isn't configured so
 * production builds without env vars don't expose dead routes.
 */
router.get("/auth/sso/login", async (req, res): Promise<void> => {
  if (!isOidcEnabled()) {
    res.status(404).end();
    return;
  }
  try {
    const state = makeState();
    const { verifier, challenge } = makePkce();
    req.session.oidcState = state;
    req.session.oidcCodeVerifier = verifier;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );
    // Forward the optional `login_hint` (typed by the user on the
    // username-first sign-in step) so the IDP can pre-fill its own
    // form. Validated/normalized via `normalizeLoginHint` (trim,
    // lowercase, RFC-shaped check, ≤ 254 chars per RFC 5321);
    // anything else is silently dropped — never 4xx, the redirect
    // still succeeds.
    const loginHint = normalizeLoginHint(req.query.login_hint);
    const url = await buildAuthorizationUrl({
      state,
      codeChallenge: challenge,
      loginHint,
    });
    res.redirect(url);
  } catch (err) {
    logger.error({ err }, "Failed to start SSO login");
    res.status(500).json({ error: "Failed to start SSO login" });
  }
});

/**
 * OIDC callback: exchanges the auth code, normalizes claims, syncs the
 * user's org memberships, picks an active org, and starts a session.
 * Always redirects back to the SPA — the SPA decides whether to land
 * on the org-picker or the home page based on `/auth/me`.
 */
router.get("/auth/sso/callback", async (req, res): Promise<void> => {
  if (!isOidcEnabled()) {
    res.status(404).end();
    return;
  }
  const cfg = getOidcConfig()!;
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  const sessionState = req.session.oidcState;
  const codeVerifier = req.session.oidcCodeVerifier;
  // One-shot: drop the in-flight state regardless of outcome so a
  // replayed callback can't be re-used.
  delete req.session.oidcState;
  delete req.session.oidcCodeVerifier;

  if (!code || !state || !sessionState || !codeVerifier || state !== sessionState) {
    // DIAGNOSTIC: a 400 here can be caused by (a) Nexus bouncing back
    // with `?error=...` instead of `?code=...`, (b) a missing or
    // mismatched session (cookie not sent / session expired), or (c)
    // a state/CSRF mismatch. Log the shape (no secrets) so we can
    // tell which one without guessing.
    req.log.warn(
      {
        codePresent: Boolean(code),
        statePresent: Boolean(state),
        sessionStatePresent: Boolean(sessionState),
        verifierPresent: Boolean(codeVerifier),
        stateMatches: Boolean(state && sessionState && state === sessionState),
        // Surface the IDP-side error so we can see e.g.
        // `invalid_scope`, `unauthorized_client`, `access_denied`,
        // etc. RFC 6749 §4.1.2.1 requires these on the callback URL.
        idpError:
          typeof req.query.error === "string" ? req.query.error : undefined,
        idpErrorDescription:
          typeof req.query.error_description === "string"
            ? req.query.error_description
            : undefined,
        idpErrorUri:
          typeof req.query.error_uri === "string"
            ? req.query.error_uri
            : undefined,
        queryKeys: Object.keys(req.query).sort(),
      },
      "OIDC callback rejected with 400 (Invalid SSO callback)",
    );
    res.status(400).json({ error: "Invalid SSO callback" });
    return;
  }

  try {
    const result = await getContainer().useCases.auth.signInOidcCallback.execute({
      code,
      state,
      sessionState,
      codeVerifier,
      claimConfig: {
        orgClaim: cfg.orgClaim,
        rolesClaim: cfg.rolesClaim,
        userClaimsNamespace: cfg.userClaimsNamespace,
        mementoUserClaim: cfg.mementoUserClaim,
        mementoAccessClaim: cfg.mementoAccessClaim,
        mementoGodModeAccessClaim: cfg.mementoGodModeAccessClaim,
        mementoGodModeRoleClaim: cfg.mementoGodModeRoleClaim,
        mementoGodModeRoleValue: cfg.mementoGodModeRoleValue,
        mementoGodModeTierClaim: cfg.mementoGodModeTierClaim,
        mementoGodModeTierValue: cfg.mementoGodModeTierValue,
      },
      session: new ExpressSessionStore(req),
    });
    if (result.kind === "err") {
      logger.error({ err: result.error }, "OIDC callback failed");
      res.redirect(`${ssoPostLoginRedirect()}login?sso_error=callback_failed`);
      return;
    }
    const outcome = result.value;
    if (outcome.kind === "userinfo_unauthorized") {
      logger.warn("OIDC /userinfo returned 401 during callback");
      res.redirect(`${ssoPostLoginRedirect()}login?sso_error=userinfo_401`);
      return;
    }
    if (outcome.kind === "deny" && outcome.marker === "no_id_token") {
      res.redirect(`${ssoPostLoginRedirect()}login?sso_error=no_id_token`);
      return;
    }
    // The use case never reaches the claim-gate / provisioning stage
    // without these. Keep the diagnostic + denial logging on the route
    // so admin observability is unchanged.
    const merged =
      outcome.kind === "success"
        ? outcome.mergedClaims
        : outcome.kind === "deny"
          ? (outcome.mergedClaims ?? null)
          : null;
    const normalized =
      outcome.kind === "success"
        ? outcome.normalized
        : outcome.kind === "deny"
          ? (outcome.normalized ?? null)
          : null;
    if (merged && normalized) {
      // DIAGNOSTIC (safe to keep on): log claim *shape* so operators can
    // tell when their `OIDC_ORG_CLAIM` / `OIDC_ROLES_CLAIM` env vars
    // don't match what the IDP actually emits. No PII (email, name)
    // is logged — just key names and the type/length of the org and
    // roles values.
    const orgVal: unknown = merged[cfg.orgClaim];
    const rolesVal: unknown = merged[cfg.rolesClaim];
    const describe = (v: unknown): string =>
      v === undefined
        ? "<<missing>>"
        : v === null
          ? "null"
          : Array.isArray(v)
            ? `array[${v.length}]`
            : typeof v;
    // Summarize an array-of-objects claim by listing the keys present
    // on each entry. No values are logged — just keys — so we can spot
    // when the IDP nests roles inside org entries (e.g. Nexus emitting
    // `organizations: [{ id, name, role }]`) without leaking data.
    const summarizeEntries = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map((entry) =>
            typeof entry === "string"
              ? entry
              : entry && typeof entry === "object"
                ? Object.keys(entry as Record<string, unknown>).sort()
                : typeof entry,
          )
        : undefined;
    req.log.info(
      {
        claimKeys: Object.keys(merged).sort(),
        orgClaimName: cfg.orgClaim,
        orgClaimType: describe(orgVal),
        orgClaimSampleValue: summarizeEntries(orgVal),
        organizationsClaimType: describe(merged["organizations"]),
        organizationsEntryKeys: summarizeEntries(merged["organizations"]),
        // First org's nested `roles` field — only the type/length, no
        // values logged unless the entries are plain strings (role
        // names like "Admin"/"Limited Admin"/"User" are not PII).
        organizationsFirstEntryRolesType: (() => {
          const orgs = merged["organizations"];
          if (!Array.isArray(orgs) || orgs.length === 0) return "<<missing>>";
          const first = orgs[0];
          if (!first || typeof first !== "object") return typeof first;
          const r = (first as Record<string, unknown>)["roles"];
          return describe(r);
        })(),
        organizationsFirstEntryRolesSample: (() => {
          const orgs = merged["organizations"];
          if (!Array.isArray(orgs) || orgs.length === 0) return undefined;
          const first = orgs[0];
          if (!first || typeof first !== "object") return undefined;
          const r = (first as Record<string, unknown>)["roles"];
          if (Array.isArray(r)) {
            return r.map((x) =>
              typeof x === "string"
                ? x
                : x && typeof x === "object"
                  ? Object.keys(x as Record<string, unknown>).sort()
                  : typeof x,
            );
          }
          return typeof r === "string" ? r : undefined;
        })(),
        rolesClaimName: cfg.rolesClaim,
        rolesClaimType: describe(rolesVal),
        rolesClaimSampleValue:
          typeof rolesVal === "string"
            ? rolesVal
            : Array.isArray(rolesVal)
              ? rolesVal.filter((v) => typeof v === "string")
              : undefined,
        userClaimsNamespace: cfg.userClaimsNamespace,
        nexusNamespacePresent:
          merged[cfg.userClaimsNamespace] !== undefined &&
          typeof merged[cfg.userClaimsNamespace] === "object" &&
          !Array.isArray(merged[cfg.userClaimsNamespace]),
      },
      "OIDC callback claim shape (diagnostic)",
    );
      req.log.info(
        {
          nexusNamespacePresent: normalized.nexusNamespacePresent,
          hasMementoUserClaim: normalized.hasMementoUserClaim,
          mementoAccessOrgCount: normalized.mementoAccessOrgKeys.size,
          rawOrgCount: normalized.orgKeys.length,
          derivedRole: normalized.role,
        },
        "OIDC callback claim-gate evaluation",
      );
    }

    if (outcome.kind === "deny") {
      // Use case already evaluated the gates and elected not to
      // establish a session. Record the denial + redirect with the
      // SPA-facing marker. Diagnostic logs from the use case carry
      // enough context; we still log the subject for grep-ability.
      // The use case strips merged/normalized from deny outcomes, so
      // we use the raw bound-org hint it returns instead.
      req.log.info(
        { marker: outcome.marker, boundOrg: outcome.boundOrg ?? null },
        "OIDC sign-in denied",
      );
      if (outcome.marker !== "no_id_token") {
        await recordSsoDenial({
          subject: outcome.subject ?? "",
          email: outcome.email ?? null,
          gate: outcome.marker,
          orgKey: outcome.boundOrg ?? null,
        });
      }
      const orgParam = outcome.boundOrg
        ? `&org=${encodeURIComponent(outcome.boundOrg)}`
        : "";
      res.redirect(
        `${ssoPostLoginRedirect()}login?sso_error=${outcome.marker}${orgParam}`,
      );
      return;
    }

    // Successful SSO sign-in: route the browser through the SPA's
    // post-login splash (task #28) so SSO users see the same brand
    // animation that local username/password sign-ins do, before
    // landing on the configured post-login destination. Error paths
    // above still redirect straight to `/login?sso_error=...`.
    const dest = ssoPostLoginRedirect();
    res.redirect(`/splash?next=${encodeURIComponent(dest)}`);
  } catch (err) {
    logger.error({ err }, "OIDC callback failed");
    res.redirect(`${ssoPostLoginRedirect()}login?sso_error=callback_failed`);
  }
});

/**
 * Dev-only control-plane endpoints for the Nexus password-reset
 * adapter's URL seam. End-to-end specs bind a Nexus stub on an
 * ephemeral loopback port and `PUT` the resulting URL here so the
 * api-server targets that stub for the duration of the run; the
 * `DELETE` clears the override on teardown. Both routes 404 outside
 * a dev environment, matching the `/auth/dev-login` gate.
 *
 * Existed because the previous design hard-pinned the stub to port
 * 47921 via `NEXUS_FORGOT_PASSWORD_URL` in `artifact.toml`, which
 * collided with parallel specs and ran into `EADDRINUSE` on re-runs.
 */
router.put(
  "/auth/dev/nexus-forgot-password-url",
  async (req, res): Promise<void> => {
    if (!isDevEnvironment()) {
      res.status(404).end();
      return;
    }
    const url =
      typeof req.body === "object" && req.body !== null
        ? (req.body as { url?: unknown }).url
        : undefined;
    if (typeof url !== "string" || url.trim().length === 0) {
      res.status(400).json({ error: "Body must be `{ url: string }`." });
      return;
    }
    try {
      // Validate that it parses as an absolute URL so a typo doesn't
      // silently install a relative path that fetch() then rejects.
      new URL(url);
    } catch {
      res.status(400).json({ error: "`url` must be an absolute URL." });
      return;
    }
    const token = readStubToken(req);
    const previous = setForgotPasswordUrlOverride(token, url);
    res.status(200).json({
      url,
      token,
      previous,
      activeCount: countForgotPasswordUrlOverrides(),
    });
  },
);

router.delete(
  "/auth/dev/nexus-forgot-password-url",
  async (req, res): Promise<void> => {
    if (!isDevEnvironment()) {
      res.status(404).end();
      return;
    }
    const token = readStubToken(req);
    const previous = setForgotPasswordUrlOverride(token, null);
    res.status(200).json({
      token,
      previous,
      activeCount: countForgotPasswordUrlOverrides(),
    });
  },
);

router.get(
  "/auth/dev/nexus-forgot-password-url",
  async (req, res): Promise<void> => {
    if (!isDevEnvironment()) {
      res.status(404).end();
      return;
    }
    const token = readStubToken(req);
    res.status(200).json({
      token,
      url: getForgotPasswordUrlOverride(token),
      activeCount: countForgotPasswordUrlOverrides(),
    });
  },
);

router.post("/auth/password-reset", emailTriggerRateLimit, async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Propagate the per-spec stub token (set by the e2e fixture via
  // `X-Nexus-Stub-Token`) into the adapter's resolver through
  // AsyncLocalStorage. Outside the e2e seam the token is `""` and
  // resolution falls back to env-driven defaults.
  const stubToken = readStubToken(req);
  const outcome = await runWithPasswordResetRequestContext(
    { stubToken },
    () =>
      getContainer().useCases.auth.requestPasswordReset.execute({
        user,
      }),
  );
  switch (outcome.kind) {
    case "ok": {
      const body = assertResponseShape(
        RequestPasswordResetResponse,
        {},
        "POST /auth/password-reset",
      );
      req.log.info(
        { userId: user.id },
        "Password-reset email requested via the identity provider",
      );
      res.status(200).json(body);
      return;
    }
    case "localUser":
      res.status(409).json({
        error:
          "Password reset isn't available for local username/password accounts. Ask an administrator to reset your password.",
      });
      return;
    case "missingEmail":
      res.status(409).json({
        error:
          "Your account has no email on file, so a reset link can't be sent. Ask an administrator to add one.",
      });
      return;
    case "throttledSelf": {
      res.setHeader("Retry-After", String(outcome.retryAfterSeconds));
      res.status(429).json({
        error:
          "You just requested a password reset. Please wait a moment before trying again.",
        retryAfterSeconds: outcome.retryAfterSeconds,
      });
      return;
    }
    case "throttledUpstream": {
      if (outcome.retryAfterSeconds !== null) {
        res.setHeader("Retry-After", String(outcome.retryAfterSeconds));
      }
      res.status(429).json({
        error: outcome.message,
        retryAfterSeconds: outcome.retryAfterSeconds,
      });
      return;
    }
    case "upstreamFailure":
      req.log.error(
        { userId: user.id, reason: outcome.reason },
        "Identity provider password-reset request failed",
      );
      res.status(502).json({ error: outcome.reason });
      return;
    case "notConfigured":
      res.status(503).json({ error: outcome.message });
      return;
  }
});

router.put("/auth/profile", async (req, res): Promise<void> => {
  const userId = req.user?.id ?? req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid profile" });
    return;
  }
  const firstName = parsed.data.firstName.trim();
  const lastName = parsed.data.lastName.trim();
  const title = parsed.data.title.trim();
  const email = parsed.data.email.trim();
  if (
    !firstName ||
    !lastName ||
    !title ||
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    res.status(400).json({ error: "All fields are required and email must be valid." });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ firstName, lastName, title, email })
    .where(eq(usersTable.id, userId))
    .returning();
  if (!updated) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(UpdateProfileResponse.parse(toPublicUser(updated)));
});

export default router;

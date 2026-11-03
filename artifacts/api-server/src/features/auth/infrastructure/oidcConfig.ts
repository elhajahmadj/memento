/**
 * Configuration for the OIDC sign-in flow. All values come from
 * environment variables so operators can wire memento up to whichever
 * provider their organization uses (Okta, Auth0, Entra ID, Keycloak,
 * etc.) without code changes.
 *
 * The OIDC provider is *additive* — when these env vars are unset the
 * SSO routes return 404 and the rest of memento behaves exactly as the
 * local-only build does. Local username/password login is unaffected
 * either way.
 */
import { logger } from "@/shared/logger";

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  /** Absolute URL the provider should redirect the browser back to. */
  redirectUrl: string;
  /**
   * Name of the ID-token / userinfo claim that holds the user's
   * organization membership(s). May be a single string or a string
   * array (e.g. `org`, `groups`).
   */
  orgClaim: string;
  /**
   * Optional claim used to derive a friendly display name for an org
   * the first time we see it. Defaults to using the raw claim value.
   */
  orgDisplayNameClaim?: string | undefined;
  /**
   * Name of the ID-token / userinfo claim that carries the user's
   * IDP roles. Nexus emits a `roles` array; defaults to `roles`.
   * When `userClaimsNamespace` is present on the token, roles are
   * read from inside the namespaced object using this same name.
   */
  rolesClaim: string;
  /**
   * Name of the namespaced object that Nexus uses to carry **user**
   * custom claims. When `claims[userClaimsNamespace]` is an object
   * we prefer reading `mementoUser` and `roles` from inside it;
   * otherwise we fall back to top-level / org-nested behavior.
   * Defaults to `https://nexus/claims`.
   */
  userClaimsNamespace: string;
  /**
   * Case-sensitive user-claim name that gates memento access. When
   * absent / falsy, the SSO callback bounces the user back to /login
   * without establishing a session and without provisioning. Lives
   * inside the namespaced object on Nexus; defaults to `mementoUser`.
   */
  mementoUserClaim: string;
  /**
   * Case-sensitive org-claim name that gates memento access. Nexus
   * emits the gate flag **inside each `organizations[]` entry**
   * alongside the org's `id`/`name`/`roles`; only orgs whose entry
   * carries this claim as truthy contribute to the user's memento
   * membership. When none of the user's orgs grant access the SSO
   * flow succeeds but no session is established. Defaults to
   * `mementoAccess`.
   */
  mementoAccessClaim: string;
  /**
   * God-mode triple — all three must match (inside the user-claim
   * source) for the user to be promoted to `memento_admin`. String
   * comparisons are case-sensitive. When any leg of the triple is
   * missing or doesn't match the user falls back to whatever role
   * the IDP `roles` claim yields and can never be `memento_admin`.
   */
  mementoGodModeAccessClaim: string;
  mementoGodModeRoleClaim: string;
  mementoGodModeRoleValue: string;
  mementoGodModeTierClaim: string;
  mementoGodModeTierValue: string;
  /**
   * Absolute URL the IDP should send the browser back to after a
   * successful end-session (logout) call. When unset, falls back to
   * the request's `${origin}/logged-out`.
   */
  postLogoutRedirectUrl?: string | undefined;
}

interface ResolvedSsoInputs {
  issuerUrl: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  redirectUrl: string | undefined;
  /** Names of the env vars that satisfied each required field, for diagnostics. */
  missing: string[];
  anyProvided: boolean;
}

function pickEnv(...names: string[]): {
  value: string | undefined;
  source: string | undefined;
} {
  for (const name of names) {
    const raw = process.env[name]?.trim();
    if (raw) return { value: raw, source: name };
  }
  return { value: undefined, source: undefined };
}

function resolveSsoInputs(): ResolvedSsoInputs {
  const issuer = pickEnv("OIDC_ISSUER_URL");
  const redirect = pickEnv("OIDC_REDIRECT_URL");
  // Prefer Nexus-named secrets when present, falling back to the
  // generic OIDC_* names so existing deployments keep working.
  const clientId = pickEnv("NEXUS_CLIENT_ID", "OIDC_CLIENT_ID");
  const clientSecret = pickEnv("NEXUS_SECRET", "OIDC_CLIENT_SECRET");

  const missing: string[] = [];
  if (!issuer.value) missing.push("OIDC_ISSUER_URL");
  if (!redirect.value) missing.push("OIDC_REDIRECT_URL");
  if (!clientId.value) missing.push("NEXUS_CLIENT_ID (or OIDC_CLIENT_ID)");
  if (!clientSecret.value) missing.push("NEXUS_SECRET (or OIDC_CLIENT_SECRET)");

  const anyProvided = Boolean(
    issuer.value || redirect.value || clientId.value || clientSecret.value,
  );

  return {
    issuerUrl: issuer.value,
    clientId: clientId.value,
    clientSecret: clientSecret.value,
    redirectUrl: redirect.value,
    missing,
    anyProvided,
  };
}

export function getOidcConfig(): OidcConfig | null {
  const inputs = resolveSsoInputs();
  if (
    !inputs.issuerUrl ||
    !inputs.clientId ||
    !inputs.clientSecret ||
    !inputs.redirectUrl
  ) {
    return null;
  }
  return {
    issuerUrl: inputs.issuerUrl,
    clientId: inputs.clientId,
    clientSecret: inputs.clientSecret,
    redirectUrl: inputs.redirectUrl,
    orgClaim: process.env.OIDC_ORG_CLAIM?.trim() || "org",
    orgDisplayNameClaim: process.env.OIDC_ORG_DISPLAY_NAME_CLAIM?.trim(),
    rolesClaim: process.env.OIDC_ROLES_CLAIM?.trim() || "roles",
    userClaimsNamespace:
      process.env.OIDC_USER_CLAIMS_NAMESPACE?.trim() || "https://nexus/claims",
    mementoUserClaim:
      process.env.OIDC_MEMENTO_USER_CLAIM?.trim() || "mementoUser",
    mementoAccessClaim:
      process.env.OIDC_MEMENTO_ACCESS_CLAIM?.trim() || "mementoAccess",
    mementoGodModeAccessClaim:
      process.env.OIDC_MEMENTO_GODMODE_ACCESS_CLAIM?.trim() || "mementoAccess",
    mementoGodModeRoleClaim:
      process.env.OIDC_MEMENTO_GODMODE_ROLE_CLAIM?.trim() || "mementoGodMode",
    mementoGodModeRoleValue:
      process.env.OIDC_MEMENTO_GODMODE_ROLE_VALUE?.trim() || "mementoAdmin",
    mementoGodModeTierClaim:
      process.env.OIDC_MEMENTO_GODMODE_TIER_CLAIM?.trim() ||
      "NexusTier reserved",
    mementoGodModeTierValue:
      process.env.OIDC_MEMENTO_GODMODE_TIER_VALUE?.trim() || "NexusAdmin",
    postLogoutRedirectUrl: process.env.OIDC_POST_LOGOUT_REDIRECT_URL?.trim(),
  };
}

export function isOidcEnabled(): boolean {
  return getOidcConfig() !== null;
}

/**
 * Log a single line at server boot describing whether SSO is wired up.
 *
 * - If every required input is set, log that SSO is enabled.
 * - If at least one (but not all) required inputs are set, log a warn
 *   line naming the missing variables — this is the most common case
 *   when an operator partially configured Nexus and is wondering why
 *   `/api/auth/sso/login` still 404s.
 * - If none are set, stay silent so local-only deploys aren't noisy.
 */
export function logSsoStartupStatus(): void {
  const inputs = resolveSsoInputs();
  if (inputs.missing.length === 0) {
    logger.info("SSO enabled: OIDC sign-in is configured");
    // Surface any non-default claim-name overrides so operators
    // running a non-Nexus IDP can see what the server resolved.
    const overrides: Record<string, string> = {};
    const ns = process.env.OIDC_USER_CLAIMS_NAMESPACE?.trim();
    if (ns) overrides.userClaimsNamespace = ns;
    const muc = process.env.OIDC_MEMENTO_USER_CLAIM?.trim();
    if (muc) overrides.mementoUserClaim = muc;
    const mac = process.env.OIDC_MEMENTO_ACCESS_CLAIM?.trim();
    if (mac) overrides.mementoAccessClaim = mac;
    const gmac = process.env.OIDC_MEMENTO_GODMODE_ACCESS_CLAIM?.trim();
    if (gmac) overrides.mementoGodModeAccessClaim = gmac;
    const gmrc = process.env.OIDC_MEMENTO_GODMODE_ROLE_CLAIM?.trim();
    if (gmrc) overrides.mementoGodModeRoleClaim = gmrc;
    const gmrv = process.env.OIDC_MEMENTO_GODMODE_ROLE_VALUE?.trim();
    if (gmrv) overrides.mementoGodModeRoleValue = gmrv;
    const gmtc = process.env.OIDC_MEMENTO_GODMODE_TIER_CLAIM?.trim();
    if (gmtc) overrides.mementoGodModeTierClaim = gmtc;
    const gmtv = process.env.OIDC_MEMENTO_GODMODE_TIER_VALUE?.trim();
    if (gmtv) overrides.mementoGodModeTierValue = gmtv;
    const rc = process.env.OIDC_ROLES_CLAIM?.trim();
    if (rc) overrides.rolesClaim = rc;
    if (Object.keys(overrides).length > 0) {
      logger.info({ overrides }, "SSO claim-name overrides resolved");
    }
    return;
  }
  if (!inputs.anyProvided) return;
  logger.warn(
    { missing: inputs.missing },
    `SSO disabled: missing ${inputs.missing.join(", ")}`,
  );
}

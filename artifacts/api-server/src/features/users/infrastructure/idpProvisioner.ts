import type { UserRole } from "@workspace/db";

/**
 * Port for an external Identity Provider that can create user accounts
 * outside memento's local `users` table. Only the `createUser` and
 * `resendWelcome` capabilities are exposed today — additional
 * operations (sync, delete, link) belong to future ports rather than
 * this one to keep the seam small and obvious.
 *
 * The default adapter is {@link StubIdpUserProvisioner}, which throws
 * {@link IdpNotConfiguredError} so the toggle is wired but inert until
 * the operator configures Nexus. The real adapter is
 * {@link NexusIdpUserProvisioner}, installed at server startup when
 * both `NEXUS_API_BASE_URL` and `NEXUS_API_KEY` are set.
 *
 * **Auth model — Nexus API key.** memento authenticates every Nexus
 * partner-endpoint call with a server-side API key
 * (`Authorization: Bearer nxk_…`) loaded from the `NEXUS_API_KEY`
 * secret. The key's org scope (set in Nexus when the key is minted)
 * must match the `organizationId` memento sends, so authorization
 * collapses to "the API key is allowed to provision in this org".
 * memento itself enforces Admin-only access on the route layer and
 * pins `organizationId` to the calling admin's active SSO org.
 */
export interface IdpUserProvisioner {
  createUser(input: IdpCreateUserInput): Promise<IdpCreateUserResult>;
  /**
   * Step 2c in the Nexus partner integration docs — emit an
   * invitation-code-only provisioning call so Nexus emails the
   * recipient a `register?code=nvi_…` link and they self-register
   * (pick their own name, password, accept terms). **No user row is
   * created in Nexus until the recipient accepts**, so the response
   * carries `{ invitationCode, expiresAt }` and explicitly NO
   * `externalId`. The route layer therefore also does not insert a
   * local `users` row at this stage — memento will see the user for
   * the first time on their first SSO sign-in after acceptance.
   *
   * Adapters MUST surface Nexus's "An active invitation already
   * exists for this email in this organization" 409 as
   * {@link IdpInvitationConflictError} so the route can translate it
   * to HTTP 409 (idempotent-success-equivalent) instead of a 502.
   */
  inviteUser(input: IdpInviteUserInput): Promise<IdpInviteUserResult>;
  /**
   * Re-deliver the IDP's welcome (registration) email to a previously
   * provisioned user, identified by the opaque `externalId` returned by
   * `createUser`. The adapter authenticates with the configured Nexus
   * API key — no per-call admin token is required. Implementations
   * surface IDP throttling via {@link IdpThrottledError} so the route
   * can return 429 with the suggested retry-after.
   */
  resendWelcome(
    externalId: string,
    mementoOrgId?: string | null,
  ): Promise<IdpResendWelcomeResult>;
  /**
   * Look up an IDP user by email. Returns the matching user (with its
   * opaque external id) when the IDP's API key can see them, or `null`
   * when no visible user matches.
   *
   * The lookup is intentionally narrow — Nexus's `GET /api/users?search`
   * applies its own org-scoping rules, so a "not found" response can
   * mean either "truly not in Nexus" or "exists but in an org the API
   * key cannot see". The route layer falls back to {@link createUser}
   * in the first case; the second case is reported back to the admin
   * by Nexus's own 409 ("Email already exists") on the create call.
   *
   * Adapters MUST do an exact case-insensitive email match on the
   * returned `data[]` array — Nexus's `search` is a substring match
   * that can return multiple non-matching rows.
   */
  findUserByEmail(
    email: string,
    mementoOrgId?: string | null,
  ): Promise<IdpFindUserResult | null>;
  /**
   * Attach an existing IDP user (by `externalId`) to an organization.
   * Used when {@link findUserByEmail} reports the user already exists
   * (e.g. they were created in another org first). Implementations
   * MUST treat Nexus's "User is already a member of this organization"
   * 400 as success (idempotent retry) and signal it via
   * `alreadyMember: true` on the result instead of throwing.
   */
  addUserToOrganization(
    input: IdpAddMemberInput,
  ): Promise<IdpAddMemberResult>;
}

export interface IdpCreateUserInput {
  username: string;
  role: UserRole;
  firstName?: string | null;
  lastName?: string | null;
  /** Email address. Required by Nexus. */
  email: string;
  /**
   * Optional initial password for the IDP account. When omitted, the
   * Nexus adapter sets `invitationCodeOnly: true` so Nexus emails the
   * user a welcome link they use to set their own password. Passing a
   * password is only useful for tests / legacy callers; the create-user
   * route does not provide one.
   */
  password?: string | null;
  /**
   * Nexus organization (GUID) to attach the new user to. Required —
   * the route layer fills this from the calling admin's active SSO org
   * (`req.session.activeOrgId`).
   */
  organizationId: string;
  /**
   * Case-sensitive name of the Nexus user-claim that gates memento
   * access (the same claim the SSO callback checks on sign-in). The
   * adapter seeds this claim with `true` (boolean) on the newly
   * provisioned user so the user can sign in via SSO immediately
   * without an operator having to add the claim by hand in Nexus's
   * admin UI. The route layer fills this from `OIDC_MEMENTO_USER_CLAIM`
   * (default `mementoUser`) so a non-default deployment stays
   * consistent with what the SSO gate is actually looking for.
   */
  mementoUserClaimName: string;
  /**
   * memento `organizations.id` (UUID) for the org being provisioned
   * into. Used by the Nexus adapter to look up the per-org partner
   * API key in `nexus_org_configs`, falling back to the deployment-
   * wide `NEXUS_API_KEY` env var when no per-org row exists. The
   * stub adapter ignores this field. `null` is accepted for system-
   * level calls that aren't scoped to an org (env-var-only path).
   */
  mementoOrgId?: string | null;
}

export interface IdpCreateUserResult {
  /**
   * Opaque identifier returned by the IDP for the newly-created user.
   * memento does not interpret this value today — it is forwarded back
   * to the caller as a hint that provisioning succeeded.
   */
  externalId: string;
}

/**
 * Input for {@link IdpUserProvisioner.inviteUser}. Mirrors
 * {@link IdpCreateUserInput} minus the password (the recipient sets
 * their own during self-registration) and the `mementoUserClaimName`
 * (Nexus has no user row to attach claims to until the invitation is
 * accepted — claim seeding is deferred to the SSO callback's
 * provisioner the first time the new user signs in).
 */
export interface IdpInviteUserInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  /** Nexus organization GUID (i.e. `organizations.external_key`). */
  organizationId: string;
  /**
   * memento `organizations.id` (UUID) for the org being invited into.
   * Used by the Nexus adapter to look up the per-org partner API key
   * in `nexus_org_configs`, falling back to `NEXUS_API_KEY`.
   */
  mementoOrgId?: string | null;
}

export interface IdpInviteUserResult {
  /** Lower-cased email Nexus echoed back. */
  email: string;
  /**
   * Opaque `nvi_…` invitation code Nexus generated. memento does not
   * surface this to admins (the recipient gets it in their email);
   * adapters return it so the route layer can log/audit if desired.
   */
  invitationCode: string;
  /** ISO-8601 timestamp at which the invitation expires. */
  expiresAt: string;
}

/**
 * Per-org IDP role tier accepted by Nexus's `POST /api/organizations/
 * {orgId}/members` endpoint. Memento's three per-org roles map 1:1 to
 * these values (`admin → org_admin`, `limited_admin → org_limited_admin`,
 * `limited → org_member`). The platform-wide tiers (`nexus_admin`,
 * `nexus_member`) are intentionally not modelled here — Nexus rejects
 * them on this endpoint with HTTP 400.
 */
export type IdpOrgRole = "org_admin" | "org_limited_admin" | "org_member";

/**
 * Translate memento's local role enum into the Nexus per-org tier that
 * the link-existing-user path needs. `memento_admin` (god-mode, never
 * actually written into a per-org membership row) collapses to
 * `org_admin` so the IDP-side assignment is sensible even when an
 * operator explicitly picks it from the Add user dialog.
 */
export function mementoRoleToIdpOrgRole(role: UserRole): IdpOrgRole {
  switch (role) {
    case "admin":
    case "memento_admin":
      return "org_admin";
    case "limited_admin":
      return "org_limited_admin";
    case "limited":
    default:
      return "org_member";
  }
}

export interface IdpFindUserResult {
  /** Opaque IDP user id (same shape `createUser` returns). */
  externalId: string;
  /** Email reported by the IDP, lower-cased before comparison. */
  email: string;
  /** Human-readable display name when the IDP provides one. */
  name: string | null;
}

export interface IdpAddMemberInput {
  /** Opaque IDP user id from {@link findUserByEmail}. */
  externalId: string;
  /** Nexus organization GUID (i.e. `organizations.external_key`). */
  organizationId: string;
  /** Per-org tier to grant on the IDP side. */
  nexusRole: IdpOrgRole;
  /**
   * memento `organizations.id` for the org we're attaching the user
   * to. Used by the Nexus adapter to pick the per-org partner API
   * key. See {@link IdpCreateUserInput.mementoOrgId}.
   */
  mementoOrgId?: string | null;
}

export interface IdpAddMemberResult {
  /**
   * `true` when the IDP reports the user was already a member of the
   * target org. Adapters MUST translate Nexus's "User is already a
   * member of this organization" 400 into this flag rather than
   * throwing — the route's intent is satisfied either way.
   */
  alreadyMember: boolean;
}

export interface IdpResendWelcomeResult {
  /** Human-readable IDP confirmation message, e.g. "Welcome email re-sent". */
  message: string;
  /** When the IDP last delivered the welcome email, if it told us. */
  lastResentAt: string | null;
  /** Total number of times the IDP has now resent, if it told us. */
  resendCount: number | null;
}

/**
 * Thrown by {@link IdpUserProvisioner.resendWelcome} when the IDP
 * applied its cooldown / max-resends limit. The route layer translates
 * this into HTTP 429 with the suggested `retryAfterSeconds` and a
 * matching `Retry-After` header.
 */
export class IdpThrottledError extends Error {
  readonly retryAfterSeconds: number | null;
  readonly lastResentAt: string | null;
  readonly resendCount: number | null;
  constructor(
    message: string,
    init: {
      retryAfterSeconds?: number | null;
      lastResentAt?: string | null;
      resendCount?: number | null;
    } = {},
  ) {
    super(message);
    this.name = "IdpThrottledError";
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.lastResentAt = init.lastResentAt ?? null;
    this.resendCount = init.resendCount ?? null;
  }
}

/** Thrown when the IDP says the user GUID does not exist. */
export class IdpUserNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdpUserNotFoundError";
  }
}

/**
 * Thrown by {@link IdpUserProvisioner.inviteUser} when Nexus reports
 * an existing, unused, unexpired invitation for the same
 * `(email, organizationId)` pair. The route layer translates this to
 * HTTP 409 with the Nexus reason — the operation is effectively
 * idempotent (the original invitation is still valid) but the admin
 * should know they didn't trigger a fresh email send.
 */
export class IdpInvitationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdpInvitationConflictError";
  }
}

/**
 * Thrown by {@link IdpUserProvisioner.createUser} when the caller asks
 * for IDP provisioning but no concrete adapter has been wired up yet.
 * Routes catch this and surface its message as HTTP 503 so the admin
 * sees a clear "IDP API key not configured" error instead of a 500
 * (or a confusing 401 from Nexus).
 */
export class IdpNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdpNotConfiguredError";
  }
}

/**
 * Stub adapter used when the operator hasn't wired up Nexus yet. Always
 * throws {@link IdpNotConfiguredError}. The presence of this
 * implementation lets the rest of the system depend on the
 * {@link IdpUserProvisioner} interface and the route layer surface a
 * clear 503 instead of a 500.
 */
export class StubIdpUserProvisioner implements IdpUserProvisioner {
  async createUser(_input: IdpCreateUserInput): Promise<IdpCreateUserResult> {
    throw new IdpNotConfiguredError(this.notConfiguredMessage());
  }
  async inviteUser(_input: IdpInviteUserInput): Promise<IdpInviteUserResult> {
    throw new IdpNotConfiguredError(this.notConfiguredMessage());
  }
  async resendWelcome(
    _externalId: string,
    _mementoOrgId?: string | null,
  ): Promise<IdpResendWelcomeResult> {
    throw new IdpNotConfiguredError(this.notConfiguredMessage());
  }
  async findUserByEmail(
    _email: string,
    _mementoOrgId?: string | null,
  ): Promise<IdpFindUserResult | null> {
    throw new IdpNotConfiguredError(this.notConfiguredMessage());
  }
  async addUserToOrganization(
    _input: IdpAddMemberInput,
  ): Promise<IdpAddMemberResult> {
    throw new IdpNotConfiguredError(this.notConfiguredMessage());
  }
  private notConfiguredMessage(): string {
    return (
      "IDP API key not configured. Set IDP_PROVISIONING_ENABLED=1, " +
      "NEXUS_API_BASE_URL, and NEXUS_API_KEY (an IdP partner key, " +
      "format `nxk_…`) on this server to enable IDP provisioning."
    );
  }
}

let provisioner: IdpUserProvisioner = new StubIdpUserProvisioner();

/** Returns the currently-installed IDP user provisioner. */
export function getIdpUserProvisioner(): IdpUserProvisioner {
  return provisioner;
}

/**
 * Replace the active provisioner. Used by tests and by the eventual
 * real-adapter wiring. Always returns the previously-installed instance
 * so callers can restore it.
 */
export function setIdpUserProvisioner(
  next: IdpUserProvisioner,
): IdpUserProvisioner {
  const prev = provisioner;
  provisioner = next;
  return prev;
}

/**
 * Whether IDP provisioning is currently usable. Gated on the
 * `IDP_PROVISIONING_ENABLED` env var so operators can flip the toggle on
 * once the real adapter is wired up. The flag controls visibility of the
 * "Provision in identity provider" toggle in the Add user dialog and is
 * exposed to the SPA via the AuthMe response.
 */
export function isIdpProvisioningEnabled(): boolean {
  const raw = process.env.IDP_PROVISIONING_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

import {
  IdpInvitationConflictError,
  IdpNotConfiguredError,
  IdpThrottledError,
  IdpUserNotFoundError,
  type IdpAddMemberInput,
  type IdpAddMemberResult,
  type IdpCreateUserInput,
  type IdpCreateUserResult,
  type IdpFindUserResult,
  type IdpInviteUserInput,
  type IdpInviteUserResult,
  type IdpResendWelcomeResult,
  type IdpUserProvisioner,
} from "./idpProvisioner";

/**
 * Resolver that returns the Nexus partner API key memento should use
 * for a given memento `organizations.id`. Returning `null` means the
 * adapter has no key for the call — it surfaces as
 * {@link IdpNotConfiguredError} so the route returns HTTP 503 with a
 * clear "no Nexus key configured" message.
 *
 * The default wiring (see `index.ts`) looks up `nexus_org_configs`
 * for the org first and falls back to the `NEXUS_API_KEY` env var so
 * single-tenant deployments keep working unchanged.
 */
export type NexusApiKeyResolver = (
  mementoOrgId: string | null,
) => Promise<string | null>;

/**
 * Configuration for the Nexus IDP adapter. The base URL points at
 * the Nexus deployment; the API key is either a constant string
 * (legacy single-tenant mode) or a per-org resolver (multi-tenant
 * mode, populated from `nexus_org_configs` with the env var as a
 * fallback).
 */
export interface NexusIdpConfig {
  baseUrl: string;
  /**
   * Either a constant API key (legacy) or a per-org resolver
   * function. Existing tests pass a string; production wires a
   * resolver that hits `nexus_org_configs` first.
   */
  apiKey?: string;
  keyResolver?: NexusApiKeyResolver;
}

export interface NexusIdpProvisionerDeps {
  fetch?: typeof fetch;
}

/**
 * Read the Nexus configuration from the process environment. Returns
 * `null` when `NEXUS_API_BASE_URL` is missing. `NEXUS_API_KEY` is
 * intentionally **not** required here anymore — per-org keys in
 * `nexus_org_configs` cover the multi-tenant case, and the resolver
 * falls back to the env var when both are absent for a given call.
 */
export function getNexusIdpConfig(): { baseUrl: string } | null {
  const baseUrl = process.env.NEXUS_API_BASE_URL?.trim();
  if (!baseUrl) return null;
  return { baseUrl };
}

/**
 * Names of Nexus env vars that are currently missing. With the
 * per-org-keys feature, only `NEXUS_API_BASE_URL` is required at
 * boot — the partner key may come from `nexus_org_configs` instead
 * of the env var. The env-var fallback is still recommended for
 * deployments that don't want admins to configure per-org keys.
 */
export function getMissingNexusIdpEnvVars(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXUS_API_BASE_URL?.trim()) {
    missing.push("NEXUS_API_BASE_URL");
  }
  return missing;
}

/**
 * Real adapter that creates and re-invites users in Nexus via the
 * partner endpoints.
 *
 * **Auth — per-org Nexus partner key.** Each request carries an
 * `Authorization: Bearer nxk_…` header. The key is resolved per call
 * from the {@link NexusApiKeyResolver}, which (in production) looks
 * up the per-org row in `nexus_org_configs` first and falls back to
 * the deployment-wide `NEXUS_API_KEY` env var. This lets each
 * organization's admins manage their own Nexus tenant's key in
 * Settings → Admin without the operator ever touching env vars.
 *
 * Translates Nexus's error responses into clear `Error` messages so
 * the route handler surfaces them as 502 with the Nexus reason; auth
 * and network failures also produce reason-bearing errors instead of
 * opaque 500s. 429 responses become {@link IdpThrottledError}; 404
 * becomes {@link IdpUserNotFoundError}.
 */
export class NexusIdpUserProvisioner implements IdpUserProvisioner {
  private readonly baseUrl: string;
  private readonly resolver: NexusApiKeyResolver;
  private readonly fetchFn: typeof fetch;

  constructor(config: NexusIdpConfig, deps: NexusIdpProvisionerDeps = {}) {
    this.baseUrl = config.baseUrl;
    if (config.keyResolver) {
      this.resolver = config.keyResolver;
    } else if (config.apiKey) {
      // Backwards-compat for tests and single-tenant wiring that
      // passes a constant key.
      const fixed = config.apiKey;
      this.resolver = async () => fixed;
    } else {
      // No key at all — every call will surface IdpNotConfiguredError.
      this.resolver = async () => null;
    }
    this.fetchFn = deps.fetch ?? fetch;
  }

  async createUser(input: IdpCreateUserInput): Promise<IdpCreateUserResult> {
    const url = `${trimTrailingSlash(this.baseUrl)}/api/users/provision`;
    // Step 2b (immediate create) per Nexus partner integration docs.
    // `invitationCodeOnly` is always `false` — that flag is for the
    // separate invite flow (see `inviteUser` below). To avoid tripping
    // Nexus's HaveIBeenPwned check on a server-generated password,
    // omit the `password` field entirely when the caller doesn't
    // supply one; per Nexus task #166 the server then mints a
    // single-use temporary password, skips HIBP / strength validation
    // on that auto-generated value, and surfaces it exactly once in
    // the welcome email. memento's route layer never supplies one.
    const hasPassword =
      typeof input.password === "string" && input.password.length > 0;
    const body: Record<string, unknown> = {
      email: input.email,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      organizationId: input.organizationId,
      invitationCodeOnly: false,
      claims: [
        {
          name: input.mementoUserClaimName,
          value: "true",
          valueType: "boolean",
        },
      ],
    };
    if (hasPassword) {
      body.password = input.password;
    }
    const response = await this.send(
      url,
      "POST",
      input.mementoOrgId ?? null,
      body,
    );
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(`IdP ${response.status}: ${message}`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`IdP returned a non-JSON success body: ${reason}`);
    }
    const externalId = extractExternalId(payload);
    if (!externalId) {
      throw new Error(
        "IdP returned a success response without an id field; cannot link the user.",
      );
    }
    return { externalId };
  }

  async inviteUser(input: IdpInviteUserInput): Promise<IdpInviteUserResult> {
    const url = `${trimTrailingSlash(this.baseUrl)}/api/users/provision`;
    // Step 2c (invitation-code) per Nexus partner integration docs.
    // No password, no claims — Nexus has no user row to attach them
    // to until the recipient self-registers. The response carries
    // `{ email, invitationCode, expiresAt }` and explicitly NO `id`.
    const body: Record<string, unknown> = {
      email: input.email,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      organizationId: input.organizationId,
      invitationCodeOnly: true,
    };
    const response = await this.send(
      url,
      "POST",
      input.mementoOrgId ?? null,
      body,
    );
    if (response.status === 409) {
      const message = await readErrorMessage(response);
      throw new IdpInvitationConflictError(`IdP 409: ${message}`);
    }
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(`IdP ${response.status}: ${message}`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`IdP returned a non-JSON success body: ${reason}`);
    }
    const result = extractInvitation(payload);
    if (!result) {
      throw new Error(
        "IdP returned a success response without invitationCode/expiresAt fields.",
      );
    }
    return result;
  }

  async findUserByEmail(
    email: string,
    mementoOrgId: string | null = null,
  ): Promise<IdpFindUserResult | null> {
    const trimmed = email.trim();
    if (!trimmed) return null;
    const url = `${trimTrailingSlash(this.baseUrl)}/api/users?search=${encodeURIComponent(trimmed)}`;
    const response = await this.send(url, "GET", mementoOrgId);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(`IdP ${response.status}: ${message}`);
    }
    const payload = (await readJsonSafely(response)) ?? {};
    const data = Array.isArray(payload.data) ? payload.data : [];
    const wanted = trimmed.toLowerCase();
    for (const entry of data) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const rowEmail =
        typeof row.email === "string" ? row.email.trim().toLowerCase() : null;
      if (!rowEmail || rowEmail !== wanted) continue;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      if (!id) continue;
      const name =
        typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
      return { externalId: id, email: rowEmail, name };
    }
    return null;
  }

  async addUserToOrganization(
    input: IdpAddMemberInput,
  ): Promise<IdpAddMemberResult> {
    const orgId = encodeURIComponent(input.organizationId);
    const url = `${trimTrailingSlash(this.baseUrl)}/api/organizations/${orgId}/members`;
    const response = await this.send(
      url,
      "POST",
      input.mementoOrgId ?? null,
      {
        userId: input.externalId,
        nexusRole: input.nexusRole,
      },
    );
    if (response.status === 400) {
      const body = await readJsonSafely(response);
      const errMsg = typeof body?.error === "string" ? body.error : "";
      if (/already a member/i.test(errMsg)) {
        return { alreadyMember: true };
      }
      throw new Error(`IdP 400: ${errMsg || "request failed"}`);
    }
    if (response.status === 404) {
      const message = await readErrorMessage(response);
      throw new IdpUserNotFoundError(`IdP 404: ${message}`);
    }
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(`IdP ${response.status}: ${message}`);
    }
    return { alreadyMember: false };
  }

  async resendWelcome(
    externalId: string,
    mementoOrgId: string | null = null,
  ): Promise<IdpResendWelcomeResult> {
    const id = encodeURIComponent(externalId);
    const url = `${trimTrailingSlash(this.baseUrl)}/api/users/${id}/resend-welcome`;
    const response = await this.send(url, "POST", mementoOrgId);
    if (response.status === 404) {
      const message = await readErrorMessage(response);
      throw new IdpUserNotFoundError(`IdP 404: ${message}`);
    }
    if (response.status === 429) {
      const body = await readJsonSafely(response);
      const retryAfterHeader = response.headers.get("retry-after");
      const headerSeconds = retryAfterHeader
        ? Number.parseInt(retryAfterHeader, 10)
        : NaN;
      const retryAfterSeconds =
        typeof body?.retryAfterSeconds === "number"
          ? body.retryAfterSeconds
          : Number.isFinite(headerSeconds)
            ? headerSeconds
            : null;
      const errMsg =
        typeof body?.error === "string" && body.error.trim()
          ? body.error.trim()
          : "Please wait before resending.";
      throw new IdpThrottledError(errMsg, {
        retryAfterSeconds,
        lastResentAt:
          typeof body?.lastResentAt === "string" ? body.lastResentAt : null,
        resendCount:
          typeof body?.resendCount === "number" ? body.resendCount : null,
      });
    }
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(`IdP ${response.status}: ${message}`);
    }
    const payload = (await readJsonSafely(response)) ?? {};
    const message =
      typeof payload.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : "Welcome email re-sent";
    return {
      message,
      lastResentAt:
        typeof payload.lastResentAt === "string" ? payload.lastResentAt : null,
      resendCount:
        typeof payload.resendCount === "number" ? payload.resendCount : null,
    };
  }

  private async send(
    url: string,
    method: "GET" | "POST",
    mementoOrgId: string | null,
    body?: unknown,
  ): Promise<Response> {
    const apiKey = await this.resolver(mementoOrgId);
    if (!apiKey) {
      throw new IdpNotConfiguredError(
        mementoOrgId
          ? `No IdP partner API key is configured for this organization. ` +
            `Set one in Settings → Admin → IdP partner keys, or set the ` +
            `NEXUS_API_KEY env var as a fallback.`
          : `No IdP partner API key is configured. Set NEXUS_API_KEY ` +
            `(an IdP partner key, format \`nxk_…\`) on this server, or ` +
            `configure a per-org key in Settings → Admin → IdP partner keys.`,
      );
    }
    const init: RequestInit = {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    try {
      return await this.fetchFn(url, init);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not reach the identity provider at ${url}: ${reason}`);
    }
  }
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText || "request failed";
  try {
    const parsed = JSON.parse(text) as
      | { message?: unknown; error?: unknown }
      | undefined;
    const message = parsed?.message ?? parsed?.error;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  } catch {
    // not JSON
  }
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

async function readJsonSafely(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const value = (await response.json()) as unknown;
    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function extractInvitation(
  payload: unknown,
): { email: string; invitationCode: string; expiresAt: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const email =
    typeof obj.email === "string" && obj.email.trim()
      ? obj.email.trim().toLowerCase()
      : null;
  const invitationCode =
    typeof obj.invitationCode === "string" && obj.invitationCode.trim()
      ? obj.invitationCode.trim()
      : null;
  const expiresAt =
    typeof obj.expiresAt === "string" && obj.expiresAt.trim()
      ? obj.expiresAt.trim()
      : null;
  if (!email || !invitationCode || !expiresAt) return null;
  return { email, invitationCode, expiresAt };
}

function extractExternalId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const direct = obj.id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = obj.user;
  if (nested && typeof nested === "object") {
    const id = (nested as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

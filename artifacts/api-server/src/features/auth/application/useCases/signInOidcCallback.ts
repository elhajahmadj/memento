/**
 * Drive the OIDC authorization-code callback end-to-end: exchange the
 * code, verify the id_token, enrich via `/userinfo`, evaluate the
 * memento user/org claim gates, provision the user, and (on success)
 * regenerate + populate the session.
 *
 * Returns a `Result` whose ok branch is a discriminated outcome so the
 * route can map success / each deny gate to the right HTTP response
 * without re-implementing the policy.
 */
import {
  err,
  ok,
  unauthorizedError,
  validationError,
  type AppError,
  type Result,
} from "@workspace/kernel";
import type { Organization, User } from "@workspace/db";
import { normalizeClaims, type NormalizedClaims } from "../../domain/claims";
import type {
  OidcGateway,
  OidcTokens,
  OidcTokenVerifier,
  SessionStore,
  UserRepository,
} from "../../domain/ports";

export type DenyMarker =
  | "no_id_token"
  | "no_memento_user"
  | "no_memento_access"
  | "no_org";

export type OidcCallbackOutcome =
  | {
      kind: "success";
      user: User;
      orgs: Organization[];
      tokens: OidcTokens;
      activeOrgId: string | null;
      /** Surfaced so the route can log the same diagnostic line. */
      normalized: NormalizedClaims;
      /** Verified id-token claim set, retained for diagnostic logging. */
      mergedClaims: Record<string, unknown>;
    }
  | {
      kind: "deny";
      marker: DenyMarker;
      boundOrg?: string | undefined;
      subject?: string | undefined;
      email?: string | undefined;
      /**
       * Surfaced on deny so the route can fire the same claim-shape
       * diagnostic it does on success. Lets operators see exactly what
       * the IDP sent when a gate trips. Undefined on `no_id_token`
       * (we haven't fetched claims yet).
       */
      normalized?: NormalizedClaims | undefined;
      mergedClaims?: Record<string, unknown> | undefined;
    }
  | { kind: "userinfo_unauthorized" };

export interface OidcClaimConfig {
  orgClaim: string;
  rolesClaim: string;
  userClaimsNamespace: string;
  mementoUserClaim: string;
  mementoAccessClaim: string;
  mementoGodModeAccessClaim: string;
  mementoGodModeRoleClaim: string;
  mementoGodModeRoleValue: string;
  mementoGodModeTierClaim: string;
  mementoGodModeTierValue: string;
}

export interface SignInOidcCallbackInput {
  code: string;
  state: string;
  sessionState: string | undefined;
  codeVerifier: string | undefined;
  claimConfig: OidcClaimConfig;
  session: SessionStore;
}

export class UserInfoUnauthorizedError extends Error {}

export class SignInOidcCallbackUseCase {
  constructor(
    private readonly verifier: OidcTokenVerifier,
    private readonly gateway: OidcGateway,
    private readonly users: UserRepository,
  ) {}

  async execute(
    input: SignInOidcCallbackInput,
  ): Promise<Result<OidcCallbackOutcome, AppError>> {
    if (
      !input.code ||
      !input.state ||
      !input.sessionState ||
      !input.codeVerifier ||
      input.state !== input.sessionState
    ) {
      return err(validationError("Invalid SSO callback"));
    }
    let tokens: OidcTokens;
    try {
      tokens = await this.gateway.exchangeCodeForTokens({
        code: input.code,
        codeVerifier: input.codeVerifier,
      });
    } catch (cause) {
      return err(unauthorizedError("OIDC token exchange failed"));
    }
    if (!tokens.id_token) {
      return ok({ kind: "deny", marker: "no_id_token" });
    }
    let idClaims: Record<string, unknown>;
    try {
      idClaims = await this.verifier.verifyIdToken(tokens.id_token);
    } catch {
      return err(unauthorizedError("Invalid id_token"));
    }
    let userInfo: Record<string, unknown>;
    try {
      userInfo = await this.gateway.fetchUserInfo(tokens.access_token);
    } catch (cause) {
      if (cause instanceof UserInfoUnauthorizedError) {
        return ok({ kind: "userinfo_unauthorized" });
      }
      throw cause;
    }
    const merged: Record<string, unknown> = { ...idClaims, ...userInfo };
    if (typeof idClaims.sub === "string") merged.sub = idClaims.sub;
    const normalized = normalizeClaims(
      merged,
      input.claimConfig.orgClaim,
      input.claimConfig.rolesClaim,
      {
        userClaimsNamespace: input.claimConfig.userClaimsNamespace,
        mementoUserClaim: input.claimConfig.mementoUserClaim,
        mementoAccessClaim: input.claimConfig.mementoAccessClaim,
        mementoGodModeAccessClaim: input.claimConfig.mementoGodModeAccessClaim,
        mementoGodModeRoleClaim: input.claimConfig.mementoGodModeRoleClaim,
        mementoGodModeRoleValue: input.claimConfig.mementoGodModeRoleValue,
        mementoGodModeTierClaim: input.claimConfig.mementoGodModeTierClaim,
        mementoGodModeTierValue: input.claimConfig.mementoGodModeTierValue,
      },
    );

    if (!normalized.hasMementoUserClaim) {
      return ok({
        kind: "deny",
        marker: "no_memento_user",
        boundOrg: normalized.orgKeys[0],
        subject: normalized.subject,
        email: normalized.email ?? undefined,
        normalized,
        mergedClaims: merged,
      });
    }

    const gated: NormalizedClaims = {
      ...normalized,
      orgKeys:
        normalized.role === "memento_admin"
          ? normalized.orgKeys
          : normalized.orgKeys.filter((k) =>
              normalized.mementoAccessOrgKeys.has(k),
            ),
    };
    const { user, orgs } = await this.users.provisionFromClaims(gated);

    const isMementoAdmin = user.role === "memento_admin";
    if (!isMementoAdmin && orgs.length === 0) {
      const marker: DenyMarker =
        normalized.orgKeys.length > 0 ? "no_memento_access" : "no_org";
      return ok({
        kind: "deny",
        marker,
        boundOrg:
          marker === "no_memento_access" ? normalized.orgKeys[0] : undefined,
        subject: normalized.subject,
        email: normalized.email ?? undefined,
        normalized,
        mergedClaims: merged,
      });
    }

    await input.session.regenerate();
    input.session.data.userId = user.id;
    input.session.data.activeOrgId = isMementoAdmin
      ? null
      : orgs.length === 1
        ? (orgs[0]?.id ?? null)
        : null;
    input.session.data.oidcIdToken = tokens.id_token;
    input.session.data.oidcAccessToken = tokens.access_token;
    if (tokens.refresh_token) {
      input.session.data.oidcRefreshToken = tokens.refresh_token;
    }
    if (typeof tokens.expires_in === "number") {
      input.session.data.oidcAccessTokenExpiresAt =
        Date.now() + tokens.expires_in * 1000;
    }
    await input.session.save();

    return ok({
      kind: "success",
      user,
      orgs,
      tokens,
      activeOrgId: input.session.data.activeOrgId,
      normalized,
      mergedClaims: merged,
    });
  }
}

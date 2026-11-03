/**
 * Verify a Nexus-issued OAuth2 access token presented as
 * `Authorization: Bearer <token>`, enrich its claims via the IDP
 * `/userinfo` endpoint, and provision/refresh the corresponding user.
 *
 * Wraps the same orchestration the bearer-auth middleware used to do
 * inline. Returns the resolved user on success, or an unauthorized
 * error for any verification / enrichment / provisioning failure.
 */
import {
  err,
  ok,
  unauthorizedError,
  type AppError,
  type Result,
} from "@workspace/kernel";
import type { User } from "@workspace/db";
import { normalizeClaims } from "../../domain/claims";
import type {
  OidcGateway,
  OidcTokenVerifier,
  UserRepository,
} from "../../domain/ports";

export interface VerifyBearerTokenInput {
  readonly token: string;
  readonly orgClaim: string;
  readonly rolesClaim: string;
  /**
   * Nexus user-claim namespace + gate-claim names. Optional so callers
   * that don't customize them get the same Nexus defaults the SSO
   * callback path uses; supplying them keeps callback and bearer
   * behavior in lockstep when the operator overrides any of the
   * `OIDC_*_CLAIM` env vars (notably the god-mode triple).
   */
  readonly userClaimsNamespace?: string;
  readonly mementoUserClaim?: string;
  readonly mementoAccessClaim?: string;
  readonly mementoGodModeAccessClaim?: string;
  readonly mementoGodModeRoleClaim?: string;
  readonly mementoGodModeRoleValue?: string;
  readonly mementoGodModeTierClaim?: string;
  readonly mementoGodModeTierValue?: string;
}

const INVALID = unauthorizedError("Invalid or expired bearer token");
const PROVISION_FAILED = unauthorizedError(
  "Failed to authenticate bearer token",
);

export class VerifyBearerTokenUseCase {
  constructor(
    private readonly verifier: OidcTokenVerifier,
    private readonly gateway: OidcGateway,
    private readonly users: UserRepository,
  ) {}

  async execute(
    input: VerifyBearerTokenInput,
  ): Promise<Result<{ user: User }, AppError>> {
    let tokenClaims: Record<string, unknown>;
    try {
      tokenClaims = await this.verifier.verifyAccessToken(input.token);
    } catch {
      return err(INVALID);
    }
    let userInfo: Record<string, unknown>;
    try {
      userInfo = await this.gateway.fetchUserInfo(input.token);
    } catch {
      return err(INVALID);
    }
    const merged: Record<string, unknown> = { ...tokenClaims, ...userInfo };
    if (typeof tokenClaims.sub === "string") merged.sub = tokenClaims.sub;
    const options: Parameters<typeof normalizeClaims>[3] = {};
    if (input.userClaimsNamespace !== undefined)
      options.userClaimsNamespace = input.userClaimsNamespace;
    if (input.mementoUserClaim !== undefined)
      options.mementoUserClaim = input.mementoUserClaim;
    if (input.mementoAccessClaim !== undefined)
      options.mementoAccessClaim = input.mementoAccessClaim;
    if (input.mementoGodModeAccessClaim !== undefined)
      options.mementoGodModeAccessClaim = input.mementoGodModeAccessClaim;
    if (input.mementoGodModeRoleClaim !== undefined)
      options.mementoGodModeRoleClaim = input.mementoGodModeRoleClaim;
    if (input.mementoGodModeRoleValue !== undefined)
      options.mementoGodModeRoleValue = input.mementoGodModeRoleValue;
    if (input.mementoGodModeTierClaim !== undefined)
      options.mementoGodModeTierClaim = input.mementoGodModeTierClaim;
    if (input.mementoGodModeTierValue !== undefined)
      options.mementoGodModeTierValue = input.mementoGodModeTierValue;
    const normalized = normalizeClaims(
      merged,
      input.orgClaim,
      input.rolesClaim,
      options,
    );
    try {
      const { user } = await this.users.provisionFromClaims(normalized);
      return ok({ user });
    } catch {
      return err(PROVISION_FAILED);
    }
  }
}

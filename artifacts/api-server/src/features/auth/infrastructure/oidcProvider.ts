/**
 * Backwards-compatible barrel for the old `oidcProvider` module. The
 * implementation has been split into focused modules under
 * `domain/claims.ts` and `infrastructure/oidc/*`; existing callers
 * (and tests) keep working unchanged by importing from here.
 */
export type {
  NormalizedClaims,
  NormalizeClaimsOptions,
  MementoRole,
} from "../domain/claims";
export {
  normalizeClaims,
  mapRoleString,
  pickRoleFromClaims,
} from "../domain/claims";

export { _resetDiscoveryCacheForTests } from "./oidc/discovery";
export { makePkce, makeState } from "./oidc/pkce";
export {
  buildAuthorizationUrl,
  buildEndSessionUrl,
  type AuthorizationUrlInput,
} from "./oidc/authorizationUrl";
export {
  exchangeCodeForTokens,
  refreshAccessToken,
  type TokenResponse,
} from "./oidc/tokenExchange";
export {
  verifyIdToken,
  verifyAccessToken,
  decodeJwtClaimsUnsafe,
  defaultTokenVerifier,
  type TokenVerifier,
} from "./oidc/tokenVerifier";
export {
  fetchUserInfo,
  UserInfoUnauthorizedError,
} from "./oidc/userInfo";
export {
  provisionFromClaims,
  listOrgsForUser,
  listOrgsWithRolesForUser,
} from "./oidc/provisioning";

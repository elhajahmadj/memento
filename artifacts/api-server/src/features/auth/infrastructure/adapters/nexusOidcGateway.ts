import type { OidcGateway, OidcTokens } from "../../domain/ports";
import { UserInfoUnauthorizedError as InfraUserInfoUnauthorizedError } from "../oidc/userInfo";
// Route IO-bound calls through the `oidcProvider` barrel so existing
// tests that `vi.spyOn(oidcProvider, "exchangeCodeForTokens")` /
// `fetchUserInfo` / `refreshAccessToken` keep intercepting the runtime
// path the gateway adapter actually takes.
import * as oidcProvider from "../oidcProvider";
import { UserInfoUnauthorizedError } from "../../application/useCases";

/**
 * Adapter for the {@link OidcGateway} port. Delegates to the existing
 * `infrastructure/oidc/*` modules via the `oidcProvider` barrel so the
 * network calls + diagnostic logging stay defined in one place and
 * test spies on the barrel continue to work. The infra-level
 * `UserInfoUnauthorizedError` is translated to the application-level
 * one so use cases never have to import infrastructure types.
 */
export class NexusOidcGateway implements OidcGateway {
  exchangeCodeForTokens(args: {
    code: string;
    codeVerifier: string;
  }): Promise<OidcTokens> {
    return oidcProvider.exchangeCodeForTokens(args);
  }
  refreshAccessToken(refreshToken: string): Promise<OidcTokens> {
    return oidcProvider.refreshAccessToken(refreshToken);
  }
  async fetchUserInfo(token: string): Promise<Record<string, unknown>> {
    try {
      return await oidcProvider.fetchUserInfo(token);
    } catch (err) {
      if (err instanceof InfraUserInfoUnauthorizedError) {
        throw new UserInfoUnauthorizedError(err.message);
      }
      throw err;
    }
  }
}

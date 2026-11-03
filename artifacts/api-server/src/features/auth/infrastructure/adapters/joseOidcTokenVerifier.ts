import type { OidcTokenVerifier } from "../../domain/ports";
// Route through the `oidcProvider` barrel so existing test spies on
// `verifyIdToken` / `verifyAccessToken` keep intercepting the runtime
// path the adapter actually takes.
import * as oidcProvider from "../oidcProvider";

/**
 * JOSE-backed adapter for the {@link OidcTokenVerifier} port. Thin
 * wrapper over the existing JWKS verifier so we keep one verification
 * codepath.
 */
export class JoseOidcTokenVerifier implements OidcTokenVerifier {
  verifyIdToken(jwt: string): Promise<Record<string, unknown>> {
    return oidcProvider.verifyIdToken(jwt);
  }
  verifyAccessToken(jwt: string): Promise<Record<string, unknown>> {
    return oidcProvider.verifyAccessToken(jwt);
  }
}

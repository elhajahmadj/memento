import { getOidcConfig } from "../oidcConfig";
import { discover } from "./discovery";

export interface AuthorizationUrlInput {
  state: string;
  codeChallenge: string;
  /**
   * Optional OIDC `login_hint`. When set, forwarded verbatim to the
   * IDP so it can pre-fill its own sign-in form. Caller is expected
   * to validate / length-cap the value.
   */
  loginHint?: string | undefined;
}

export async function buildAuthorizationUrl(
  input: AuthorizationUrlInput,
): Promise<string> {
  const cfg = getOidcConfig();
  if (!cfg) throw new Error("OIDC is not configured");
  const doc = await discover(cfg);
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUrl);
  // Scopes:
  //  - `openid profile email`: standard OIDC identity claims.
  //  - `offline_access`: requests a refresh_token from Nexus so we can
  //    rotate access tokens without bouncing the user back through the
  //    browser flow.
  //  - `organizations`: Nexus-specific scope that projects the user's
  //    org memberships into the ID token / userinfo response. Without
  //    this scope, Nexus does NOT emit any `org` claim and memento
  //    can't tell what tenant a freshly-signed-in IDP user belongs to.
  //  - `roles`: Nexus-specific scope that projects the user's
  //    `org_members.role_id` row name (`Admin` / `Limited Admin` /
  //    `User`) into the `roles` claim. Without this scope, Nexus
  //    sends `roles: []` and memento defaults every IDP user to the
  //    User role — which means even a Nexus admin sees "no access"
  //    on Settings.
  //    Nexus enforces scope allow-lists per OIDC client; if the
  //    memento client doesn't have `organizations` / `roles`
  //    allow-listed, Nexus will reject the entire authorize request
  //    with `error=invalid_scope`. If you see that error in the
  //    api-server log, ask whoever runs Nexus to enable the missing
  //    scope on the memento client and try again.
  // IDPs that don't recognize a given scope are expected to ignore it,
  // so this string is safe to send to non-Nexus providers too.
  url.searchParams.set(
    "scope",
    "openid profile email offline_access organizations roles",
  );
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.loginHint) {
    url.searchParams.set("login_hint", input.loginHint);
  }
  return url.toString();
}

/** URL the browser should hit to sign the user out of the IDP itself. */
export async function buildEndSessionUrl(args: {
  idTokenHint: string;
  postLogoutRedirectUrl: string;
}): Promise<string | null> {
  const cfg = getOidcConfig();
  if (!cfg) return null;
  const doc = await discover(cfg);
  if (!doc.end_session_endpoint) return null;
  const url = new URL(doc.end_session_endpoint);
  url.searchParams.set("id_token_hint", args.idTokenHint);
  url.searchParams.set(
    "post_logout_redirect_uri",
    args.postLogoutRedirectUrl,
  );
  url.searchParams.set("client_id", cfg.clientId);
  return url.toString();
}

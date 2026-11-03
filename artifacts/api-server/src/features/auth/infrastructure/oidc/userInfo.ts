import { getOidcConfig } from "../oidcConfig";
import { discover } from "./discovery";

/**
 * Sentinel error thrown when the IDP rejects the access token at
 * `/userinfo` (HTTP 401). Callers should treat this as an
 * authentication failure — clear any cached session state and force
 * the user back through the browser sign-in flow — rather than
 * continuing with empty claims (which would silently demote the user
 * or wipe their org memberships).
 */
export class UserInfoUnauthorizedError extends Error {
  constructor() {
    super("IDP /userinfo returned 401");
    this.name = "UserInfoUnauthorizedError";
  }
}

export async function fetchUserInfo(accessToken: string): Promise<
  Record<string, unknown>
> {
  const cfg = getOidcConfig();
  if (!cfg) throw new Error("OIDC is not configured");
  const doc = await discover(cfg);
  if (!doc.userinfo_endpoint) return {};
  const res = await fetch(doc.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    // Hard-fail: an expired/revoked access token must not silently
    // succeed with `{}` claims, which would let downstream callers
    // continue as if the IDP had returned an empty roles/orgs payload
    // and demote the user.
    throw new UserInfoUnauthorizedError();
  }
  if (!res.ok) {
    throw new Error(
      `IDP /userinfo failed with HTTP ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

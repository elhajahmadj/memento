import type { AuthOrganizationRole } from "@workspace/api-client-react";

/**
 * Short human-friendly labels for the per-org role returned in each
 * `/auth/me` `organizations[]` entry. Used by both the user-menu org
 * switcher and the post-login org picker so the two surfaces always
 * render the same wording (e.g. "Admin", "Limited Admin", "User").
 *
 * Returns `null` when no label should be rendered — either because the
 * role is missing/null on the payload (today: never for real IDP
 * memberships, but the type allows it) or because the value is the
 * sentinel `"none"`. Callers should treat `null` as "render the org
 * name alone, with no role suffix".
 */
const ORG_ROLE_LABELS: Record<string, string | null> = {
  admin: "Admin",
  limited_admin: "Limited Admin",
  limited: "User",
  none: null,
};

export function orgRoleLabel(
  role: AuthOrganizationRole | null | undefined,
): string | null {
  return ORG_ROLE_LABELS[role ?? "none"] ?? null;
}

import type { AuthUserRole } from "@workspace/api-client-react";

/**
 * Plain-language role catalog. Single source of truth for how each
 * memento role is presented to non-technical admins: a friendly name,
 * a one-line summary, the things this role can do, and the things it
 * cannot. Both the Invite Teammate wizard and the AccessGate banner
 * read from this catalog so the vocabulary stays consistent across
 * every surface that talks about roles.
 */

/**
 * Roles that can be held by a *teammate*. Excludes `guest`: a guest is
 * a throwaway trial identity minted by "Continue as guest", never
 * something an admin invites someone as or grants. Keeping it out of
 * this type is what stops the invite wizard and the access-request
 * gate from ever offering it.
 */
export type TeamRole = Exclude<AuthUserRole, "guest">;

export interface RoleCatalogEntry {
  readonly role: TeamRole;
  /** Plain-language display name. */
  readonly displayName: string;
  /** Shorter label for compact contexts (table cells, badges). */
  readonly shortName: string;
  /** One-line elevator pitch. */
  readonly summary: string;
  /** Bullet list of capabilities, phrased in user terms. */
  readonly canDo: readonly string[];
  /** Bullet list of meaningful restrictions. */
  readonly cantDo: readonly string[];
  /**
   * When true, this role is god-mode and only an existing god-mode
   * caller may grant it. Hidden from the invite wizard for everyone
   * except Memento Admins.
   */
  readonly godMode: boolean;
}

export const ROLE_CATALOG: Record<TeamRole, RoleCatalogEntry> = {
  memento_admin: {
    role: "memento_admin",
    displayName: "Owner",
    shortName: "Owner",
    summary:
      "Full access to every project, every organization, and every setting.",
    canDo: [
      "See and edit every project across every organization",
      "Grant or revoke any role, including Owner",
      "Change billing, source-control, and identity-provider settings",
    ],
    cantDo: ["(nothing — this is the highest role)"],
    godMode: true,
  },
  admin: {
    role: "admin",
    displayName: "Team Admin",
    shortName: "Admin",
    summary:
      "Runs the team for one organization: invites teammates, approves work, and configures the workspace.",
    canDo: [
      "Invite, edit, and remove teammates in this organization",
      "Approve fork requests and merge submitted work",
      "Configure project Git repos and integrations",
    ],
    cantDo: [
      "See or change projects in other organizations",
      "Grant the Owner role",
    ],
    godMode: false,
  },
  limited_admin: {
    role: "limited_admin",
    displayName: "Tester",
    shortName: "Tester",
    summary:
      "Builds and runs tests on projects assigned to them, and approves changes within their scope.",
    canDo: [
      "Build, edit, and run tests on assigned projects",
      "Approve or reject fork submissions on assigned projects",
      "Request access to additional projects",
    ],
    cantDo: [
      "See projects they aren't assigned to",
      "Invite teammates or change global settings",
    ],
    godMode: false,
  },
  limited: {
    role: "limited",
    displayName: "Viewer",
    shortName: "Viewer",
    summary:
      "Read-only collaborator. Can view assigned projects and submit fork requests, but can't approve anything.",
    canDo: [
      "View assigned projects and their tests",
      "Record and submit a fork for review",
      "Request access to additional projects",
    ],
    cantDo: [
      "Approve or merge work",
      "Edit teammates or workspace settings",
    ],
    godMode: false,
  },
};

export const ROLE_ORDER: readonly TeamRole[] = [
  "memento_admin",
  "admin",
  "limited_admin",
  "limited",
] as const;

export function getRoleEntry(role: TeamRole): RoleCatalogEntry {
  return ROLE_CATALOG[role];
}

export function getRoleDisplayName(role: TeamRole): string {
  return ROLE_CATALOG[role].displayName;
}

export function getRoleShortName(role: TeamRole): string {
  return ROLE_CATALOG[role].shortName;
}

/**
 * Roles the caller is allowed to grant in the Invite Teammate wizard.
 * Non-Memento-Admins cannot mint a new Memento Admin.
 */
export function rolesGrantableBy(
  callerIsMementoAdmin: boolean,
): readonly RoleCatalogEntry[] {
  return ROLE_ORDER.filter(
    (r) => callerIsMementoAdmin || !ROLE_CATALOG[r].godMode,
  ).map((r) => ROLE_CATALOG[r]);
}

import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "admin-users",
    heading: "Admin — Users",
    intro:
      "Manage who can sign in and what role they get. Full admins can change roles and create local users; limited admins can authorize new users for projects they're assigned to but cannot change another user's role.",
    walkthrough: [
      "Open Admin → Users.",
      "Find the user in the table.",
      "Use the role selector to change between Admin, Limited Admin, and User (admins only).",
      "Use Authorize to grant a pending user access to a project (limited admins, scoped to assigned projects).",
      "Use Delete to permanently remove a user account; a confirmation dialog protects against accidents and the button is disabled for your own row and for the last remaining admin.",
    ],
    fields: [
      { name: "Name / Username", description: "Identifies the account." },
      { name: "Role", description: "Admin, Limited Admin, or User. Editable by full admins only." },
      { name: "Last login", description: "Most recent successful sign-in." },
      {
        name: "Sign-in source",
        description:
          "How the user authenticates: 'Local' for username/password (seeded admins, dev-login, password-only accounts) or 'SSO' for users provisioned through the OIDC identity provider. SSO users are bounded by their active organization; local users keep the pre-tenant global view.",
      },
      { name: "Actions", description: "Edit profile, or Delete (admin only). Delete is blocked for your own row and for the last remaining admin, and removes the user along with their forks, recordings, mocks, and audit history." },
      {
        name: "SSO setup (org-gate)",
        description:
          "memento grants org-level access by reading a per-organization `mementoAccess` claim from inside each `organizations[]` entry in the IdP token (alongside the org's id/name/roles, granted by the IdP's `organizations` scope). Set this claim on every org that should be allowed to use memento via your identity provider's admin UI; orgs without it are filtered out, and a user with no granting orgs is denied with \"Sign-in succeeded, but your organization isn't authorized for memento yet.\" A top-level `org_id` claim is no longer required for the org-gate. Memento Admin bypasses the gate entirely (god-mode super role).",
      },
      {
        name: "SSO setup (god-mode triple)",
        description:
          "Memento Admin (the god-mode super role) is granted iff a three-claim combo is present inside the namespaced claims object (top-level when no namespace): `mementoAccess` is truthy, the configured god-mode role claim equals its configured role value, and the configured god-mode tier claim equals its configured tier value. String comparisons are case-sensitive. When any leg of the triple is missing or doesn't match, an IdP-asserted \"Memento Admin\" role is silently downgraded to plain Admin (the user still signs in, just without cross-org visibility) and no combination of IdP-asserted roles can produce Memento Admin. Promoting a user therefore takes two steps: assign the role in your identity provider, then set all three claims on that user's custom claims.",
      },
    ],
  },
];

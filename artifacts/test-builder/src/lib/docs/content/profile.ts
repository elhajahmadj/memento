import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "profile",
    heading: "Profile (User info + Password)",
    intro:
      "Your account details. New users complete their profile on first sign-in at /profile/complete (single-form, no tabs); once that's done /profile renders a tabbed layout with two tabs — User info (default) and Password — sharing the standard Card + PageShell chrome used everywhere else in the app. The User info tab holds the same fields it always has (First name, Last name, Title, Email) plus the theme picker; the Password tab is where SSO users ask the identity provider to email them a reset link. If you signed in with SSO, the user menu also shows your active organization and a switcher when your IdP grants you more than one — every list of projects, forks, approvals, access requests, and assignments in the app is filtered to that active org. Local username/password users (including the seeded admins and the dev-login shortcut) never see the switcher and keep the pre-tenant global view of every project.",
    walkthrough: [
      "Open Profile from the user menu.",
      "On the User info tab, edit your first name, last name, title, and (for local accounts) email. SSO users see Email as read-only with a small \"Update at your identity provider\" link below it that opens the identity provider's profile page in a new tab — the identity provider owns the canonical record.",
      "Pick a theme (Light, Dark, or System) and Save.",
      "To change your password, switch to the Password tab. SSO accounts: click Reset password, confirm in the modal, and watch for the success toast — the identity provider emails the reset link to your address on file. The button then disables for a 60-second cooldown so a buggy click can't spam the IdP.",
      "Local accounts: the Password tab still renders, but the button is disabled with explanatory copy — your administrator resets local passwords for you.",
      "SSO users with multiple orgs: open the user menu to switch your active organization. The page reloads scoped to the new org — projects from other orgs disappear from every screen until you switch back.",
    ],
    fields: [
      { name: "First name / Last name", description: "Required to complete the profile." },
      { name: "Title", description: "Free-form job title shown in audit entries." },
      {
        name: "Email (User info tab)",
        description:
          "Editable for local username/password accounts exactly as before. For SSO users it's rendered read-only (greyed out, copy/select still works) with an \"Update at your identity provider\" hyperlink immediately below — the identity provider is the source of truth for the email and password.",
      },
      { name: "Theme", description: "Light, Dark, or System." },
      {
        name: "Reset password (Password tab)",
        description:
          "SSO accounts only. Opens a confirmation modal (\"We'll email you a reset link at <your email> — continue?\") and, on confirm, asks the identity provider to email a reset link to the address on file. The success toast (\"If an account exists for that email, we've sent a reset link. Check your inbox.\") is intentionally generic regardless of whether the email is on file. The button is disabled for 60 seconds after a successful call. If the identity provider is rate-limiting (429) the toast reads \"Too many attempts. Try again in a minute.\"; on identity-provider 5xx / network failure the toast reads \"Couldn't reach our identity provider. Try again in a moment.\" and the button re-enables so you can retry. If the server isn't configured with an identity provider (503), a small inline operator notice appears in place of the toast.",
      },
      {
        name: "Reset password (local accounts)",
        description:
          "Disabled for local username/password users with the copy \"Password reset isn't available for local accounts. Ask an administrator to reset your password.\" Local passwords are reset by an admin from Admin → Users, not from this page.",
      },
      {
        name: "Active organization (SSO only)",
        description:
          "Shown in the user menu for users provisioned via SSO. Switching it re-scopes every project surface (home, workbench, tools, settings) to that org. Hidden for local users.",
      },
      {
        name: "Sign-in source",
        description:
          "Local username/password (including dev-login and seeded users) keeps the pre-tenant global view. SSO accounts are bounded by their active org; an SSO user removed from every org by their IDP sees nothing until membership is restored.",
      },
    ],
  },
];

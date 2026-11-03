import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "admin-team",
    heading: "Admin — Managing your team",
    intro:
      "The Team admin panel is the plain-language home for everything to do with the people on your workspace: who's on the team today, who's been invited but hasn't accepted yet, and how to add someone new. Open it from Admin → Team. Two tabs — Members and Pending invitations — share a single Invite teammate button at the top of the section.",
    walkthrough: [
      "Open Admin → Team to land on the Members tab. You'll see every teammate in your active organization with their name, role, last sign-in, and how they sign in (Local or SSO).",
      "Change someone's role from the role dropdown on their row. A confirmation prompt summarizes what changes (e.g. \"Tester → Team Admin grants invite + approval rights\") before applying.",
      "Switch to the Pending invitations tab to see invitations that haven't been accepted yet, who sent them, and when they expire. Each row offers Resend (which renews the link and re-sends the email) and Revoke (which kills the link immediately).",
      "Click Invite teammate at the top of the section to open the 4-step wizard: 1) Who you're inviting (first name, last name, email — only email is required), 2) Pick their role from the plain-language catalog (Owner, Team Admin, Tester, Viewer), 3) Choose how to deliver the invite (email a link, copy a link to share yourself, or provision the account directly in the identity provider), 4) Review and send.",
      "After sending, the wizard shows the invitation link so you can copy it if you picked \"Copy link\" — the row also appears immediately on the Pending invitations tab.",
    ],
    fields: [
      {
        name: "Members tab",
        description:
          "The active organization's user list. Reuses the same table as the legacy Users page so name / username / role / last login / sign-in source columns are unchanged.",
      },
      {
        name: "Pending invitations tab",
        description:
          "Every invitation in pending status for the active organization (Memento Admin sees every pending invitation across every organization). Columns: email, role, delivery method, sent by, expires in. Row actions: Resend, Revoke.",
      },
      {
        name: "Invite teammate (button)",
        description:
          "Visible only to admins (Team Admin, Memento Admin) — Testers can read the page but the button is hidden for them. Opens the 4-step wizard described above.",
      },
      {
        name: "Role catalog (used in step 2 of the wizard and on the role-change confirm)",
        description:
          "Plain-language role names with a one-line elevator pitch and a \"can do / can't do\" breakdown — the same vocabulary the AccessGate banner uses. The four roles are: Owner (Memento Admin, god-mode super role — only an existing Owner may grant it, so the row is hidden for everyone else), Team Admin (runs the team for one organization), Tester (builds and runs tests on assigned projects), and Viewer (read-only collaborator).",
      },
      {
        name: "Delivery method (step 3 of the wizard)",
        description:
          "Email a link — memento emails the recipient a one-time accept link. Copy link — memento shows you the link to paste into chat or a ticket yourself. Provision in our identity provider — creates the account directly in your identity provider (so they can sign in via SSO immediately, with the welcome email coming from the identity provider). The third option is greyed out and disabled unless you signed in via SSO yourself, have picked an active organization, and the server has IDP provisioning enabled — local username/password admins are intentionally restricted from creating SSO users.",
      },
      {
        name: "SSO-required rule (IDP delivery only)",
        description:
          "The \"Provision in our identity provider\" delivery method routes through POST /api/users/invite, which gates on the caller being signed in via SSO (an OIDC access token on the session is the proof). Local username/password admins get a 403 with an \"SSO required\" message and the option is disabled in the wizard. The email-link and copy-link delivery methods have no SSO requirement and work for every admin.",
      },
      {
        name: "Active-organization requirement (IDP delivery only)",
        description:
          "IDP provisioning attaches the new IdP user to the calling admin's active organization. Admins with no active org picked get a 403 asking them to pick one first; the wizard surfaces this as a toast and routes them through the org switcher. The email and copy-link paths simply stamp organizationId on the invitation row from the session's active org (null when none is picked) — they don't fail without one.",
      },
    ],
  },
];

import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "dashboard",
    heading: "Home — post-login landing",
    intro:
      "Home (`/`) is the first page memento sends you to after a successful sign-in (local or SSO). It shows role-tailored, clickable widgets so you can jump straight to whatever needs attention — your runs, your projects, your drafts, and (for admins) org-wide health, top failing tests, users, projects, integrations, organizations, and system health. The old `/dashboard` URL still works and now redirects to `/`. The Projects picker (where you scaffold or open a project) lives at `/projects`.",
    walkthrough: [
      "Sign in (local username/password or SSO via your identity provider — including the multi-org picker when applicable). memento plays the brand splash animation once, then forwards you to / (Home, the server-configured post-login destination).",
      "Scan the widgets across the top: each one is a clickable shortcut into the matching deep page.",
      "Users see My recent runs, My projects, and Drafts in progress.",
      "Limited Admins also see Projects I administer and Recent activity in my projects.",
      "Admins additionally see Org health, Top failing tests, Users, Projects, and Integrations.",
      "Memento Admin additionally sees Organizations (cross-org leaderboard) and System health.",
    ],
    fields: [
      { name: "My recent runs", description: "Last 5 validation runs you triggered. Click a row to open the run in /tools/test-runs." },
      { name: "My projects", description: "Recently touched projects you can see. Click a tile to open it." },
      { name: "Drafts in progress", description: "AI-agent runs you started that are still pending or running." },
      { name: "Projects I administer", description: "Limited Admin and above only: count of projects in your scope." },
      { name: "Recent activity in my projects", description: "Limited Admin and above only: most recent runs across your administered projects." },
      { name: "Org health", description: "Admin and above: pass-rate over the selected window for your org's projects." },
      { name: "Top failing tests", description: "Admin and above: tests with the most failures in the window." },
      { name: "Users", description: "Admin and above: active-this-week + new-in-window counters, linking to Admin → Users." },
      { name: "Projects", description: "Admin and above: total projects + stale (no runs in 30d), linking to the Projects page." },
      { name: "Integrations", description: "Admin and above: SSO vs local user counts and Git repos with PATs configured." },
      { name: "Organizations", description: "Memento Admin only: total org count and a top-5 runs leaderboard across all orgs." },
      { name: "System health", description: "Memento Admin only: recent admin actions in the last 24h and API error rate (when known)." },
    ],
  },
];

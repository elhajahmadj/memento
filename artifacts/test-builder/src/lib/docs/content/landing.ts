import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "landing",
    heading: "Landing page (signed out)",
    intro:
      "The marketing surface served from `/` to anyone who is not signed in. It is intentionally minimal: a top header with the memento word-mark and a `Login` button, and a centered oversized `memento` logotype. Once a user has a valid session, the same `/` route renders the role-aware Home (admin/limited admin tiles, or the user's forks-only landing) instead.",
    walkthrough: [
      "Open the app's root URL in a browser without a memento session (or after signing out). The Landing page renders automatically — the `/` route picks Landing vs. Home based on whether `useAuth()` has a user.",
      "Click `Login` (top-right) to go to `/login` and sign in via username/password or, when configured, the SSO provider.",
      "After a successful sign-in, the app redirects you back to `/` — and now the role-aware Home renders instead of Landing. Sign out from the user menu to return to this page.",
    ],
    fields: [
      {
        name: "Header — Logo",
        description:
          "The shared `<Logo />` word-mark, identical to the one in the signed-in top nav so the brand stays consistent across the auth boundary.",
      },
      {
        name: "Header — Login button",
        description:
          "Navigates to `/login`. `data-testid=\"landing-login-button\"` so end-to-end tests (including the docs-screenshot harness) can target it deterministically.",
      },
      {
        name: "Hero word-mark",
        description:
          "Oversized `memento` logotype with a brand gradient on the leading `m`. Marked `aria-label=\"memento\"` so it announces sensibly to screen readers; `data-testid=\"landing-logo\"` for tests.",
      },
      {
        name: "Footer",
        description:
          "Shared `<Footer />` component, same one rendered on the signed-in surfaces.",
      },
      {
        name: "Routing",
        description:
          "Selected by `Root` in `App.tsx`: `return user ? <Dashboard /> : <Landing />`. Signed-out visitors see the public Landing marketing page at `/`; signed-in users see the role-tailored Dashboard. The Projects picker has moved to `/projects`. The `AuthGate` explicitly allows `/` for signed-out visitors (it only redirects signed-out traffic to `/login` for any path other than `/` and `/login` itself).",
      },
    ],
  },
];

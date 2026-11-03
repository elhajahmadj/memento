import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "onboarding-tour",
    heading: "Home — First-run tour",
    intro:
      "A 5-step coachmark tour that explains the core record-edit-validate-mock loop. It auto-launches the very first time a freshly seeded user signs in (`hasSeenTour: false` on the `users` row), and never shows itself again afterwards. You can replay the tour any time from the user-menu's `Take the tour` item.",
    walkthrough: [
      "Sign in as a user who has not yet seen the tour. The overlay opens automatically on the home page (and on the workbench) after `GET /api/users/me/tour-state` returns `{ hasSeenTour: false }`.",
      "Step through the cards with the Back / Next buttons; each card is captioned `Step N of 5`.",
      "Click anywhere on the dim backdrop, the X in the top-right, or `Got it` on the final card to dismiss the tour. Dismissal POSTs `hasSeenTour: true` to `/api/users/me/tour-seen`, so the tour does not re-open on subsequent sessions.",
      "To take the tour again later, open the user menu (top-right) and click `Take the tour`. This dispatches a window-level `onboarding:relaunch` event the overlay listens for, re-opening the tour without changing the persisted `hasSeenTour` state.",
      "From the workbench, the same overlay can be replayed via the new Help menu in the top toolbar (`Replay onboarding tour`). That action additionally POSTs `hasSeenTour: false` to `/api/users/me/tour-seen` so the tour also auto-launches the next time the user lands on a home page.",
    ],
    fields: [
      { name: "5-step content", description: "Welcome → Start a recording → Add assertions → Mock the network → Validate. Step copy lives in `artifacts/test-builder/src/features/onboarding/presentation/onboarding-tour.tsx`." },
      { name: "Per-user persistence", description: "Backed by the `users.has_seen_tour` boolean column. `GET /api/users/me/tour-state` returns its current value; `POST /api/users/me/tour-seen { hasSeenTour: true }` flips it." },
      { name: "Dismissal", description: "Closing via the X, the backdrop, or the final `Got it` button all mark the tour as seen so it never auto-opens again." },
      { name: "Take the tour menu item", description: "User menu (top-right) → `Take the tour` dispatches `window.dispatchEvent(new CustomEvent(\"onboarding:relaunch\"))`; the overlay listens for that event and re-opens the tour without writing to the database." },
      { name: "Replay onboarding tour menu item", description: "Workbench top toolbar → Help menu → `Replay onboarding tour` POSTs `hasSeenTour: false` to `/api/users/me/tour-seen`, invalidates the cached `tour-state` query, and dispatches the same `onboarding:relaunch` event so the overlay reopens immediately. Implemented in `help-menu.tsx`." },
      { name: "Render locations", description: "The `<OnboardingTour />` component is mounted on the admin home (`admin-projects-home.tsx`), the user home (`limited-home.tsx`), and the workbench (`workbench.tsx`) so the auto-launch fires on whichever page the user lands on first." },
    ],
  },
];

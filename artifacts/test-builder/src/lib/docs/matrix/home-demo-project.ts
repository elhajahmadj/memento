import type { DocsMatrixEntry } from "../matrix";
import { ANY_ADMIN } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "home-demo-project",
    label: "Projects — Try the demo project",
    category: "Workspace",
    route: "/projects",
    // The "Try the demo" card lives on the admin home (see
    // `admin-projects-home.tsx`); regular users land on the
    // forks-only `LimitedHome` which does not show it.
    allowedRoles: ANY_ADMIN,
    // The capture harness scrolls the `card-try-the-demo` element
    // into view before screenshotting so the dedicated shot focuses
    // on the demo CTA — see capture.spec.ts.
  };

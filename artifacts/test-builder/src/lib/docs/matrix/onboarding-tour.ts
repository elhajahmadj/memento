import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "onboarding-tour",
    label: "Projects — First-run tour",
    category: "Workspace",
    route: "/projects",
    // The onboarding overlay renders on top of the home page (and the
    // workbench) for every signed-in role and can be relaunched from
    // the user menu's "Take the tour" item. The capture harness
    // dispatches `onboarding:relaunch` to surface the overlay before
    // screenshotting — see capture.spec.ts.
    allowedRoles: ALL_ROLES,
  };

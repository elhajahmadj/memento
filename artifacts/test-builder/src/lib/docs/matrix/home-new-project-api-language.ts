import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "home-new-project-api-language",
    label: "Projects — New project: API language picker",
    category: "Workspace",
    route: "/projects",
    // The "New project" button on admin-projects-home is gated by
    // `useIsAdmin()` — Limited Admin and User do not see it — so this
    // doc is Admin-only to match where the action actually exists.
    allowedRoles: ADMIN_ONLY,
    // Captured by `driveHomeSection` — opens the New project dialog,
    // selects solution-type "API", and opens the Language select so
    // the four language options (C# / Python / Node.js / Java) are
    // visible in the screenshot.
  };

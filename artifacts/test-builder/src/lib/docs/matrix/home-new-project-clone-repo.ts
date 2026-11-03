import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "home-new-project-clone-repo",
    label: "Projects — New project: Clone from repo",
    category: "Workspace",
    route: "/projects",
    // The "New project" button on admin-projects-home is gated by
    // `useIsAdmin()` — Limited Admin and User do not see it — so this
    // doc is Admin-only to match where the action actually exists.
    allowedRoles: ADMIN_ONLY,
    // The capture harness will open the New project dialog and switch
    // to the second tab ("Clone from repo") before screenshotting.
    // Until that capture step ships the screenshot reuses the
    // existing New-project / API-language JPEG so the doc page still
    // renders.
    screenshotKey: "home-new-project-api-language",
  };

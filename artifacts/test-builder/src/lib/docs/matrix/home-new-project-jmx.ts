import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
  sectionId: "home-new-project-jmx",
  label: "Projects — New project: JMX Builder tab",
  category: "Workspace",
  route: "/projects",
  // The "New project" button on admin-projects-home is gated by
  // `useIsAdmin()` — Limited Admin and User do not see it — so this
  // doc is Admin-only to match where the action actually exists.
  allowedRoles: ADMIN_ONLY,
};

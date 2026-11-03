import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "admin-git-repos",
    label: "Project Git Repos",
    category: "Admin",
    route: "/admin",
    allowedRoles: ADMIN_ONLY,
    settingsSectionTestId: "git-repos",
  };

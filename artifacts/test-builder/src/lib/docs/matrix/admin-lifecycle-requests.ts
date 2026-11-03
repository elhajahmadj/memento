import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "admin-lifecycle-requests",
    label: "Pending deletions",
    category: "Admin",
    route: "/admin",
    allowedRoles: ADMIN_ONLY,
    settingsSectionTestId: "lifecycle-requests",
  };

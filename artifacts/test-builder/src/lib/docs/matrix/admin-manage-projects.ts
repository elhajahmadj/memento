import type { DocsMatrixEntry } from "../matrix";
import { ANY_ADMIN } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "admin-manage-projects",
    label: "Manage Projects",
    category: "Admin",
    route: "/admin",
    allowedRoles: ANY_ADMIN,
    settingsSectionTestId: "manage-projects",
  };

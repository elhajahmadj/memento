import type { DocsMatrixEntry } from "../matrix";
import { ANY_ADMIN } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "admin-users",
    label: "Users",
    category: "Admin",
    route: "/admin",
    allowedRoles: ANY_ADMIN,
    settingsSectionTestId: "users",
  };

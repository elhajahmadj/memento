import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "settings-architectures",
    label: "Architectures",
    category: "Admin",
    route: "/admin",
    allowedRoles: ADMIN_ONLY,
    settingsSectionTestId: "architectures",
  };

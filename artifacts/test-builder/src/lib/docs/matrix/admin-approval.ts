import type { DocsMatrixEntry } from "../matrix";
import { ANY_ADMIN } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "admin-approval",
    label: "Code changes (approvals)",
    category: "Admin",
    route: "/admin",
    allowedRoles: ANY_ADMIN,
    settingsSectionTestId: "approval",
  };

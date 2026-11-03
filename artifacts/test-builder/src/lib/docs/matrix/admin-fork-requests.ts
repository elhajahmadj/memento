import type { DocsMatrixEntry } from "../matrix";
import { ANY_ADMIN } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "admin-fork-requests",
    label: "Fork requests",
    category: "Admin",
    route: "/admin",
    allowedRoles: ANY_ADMIN,
    settingsSectionTestId: "fork-requests",
  };

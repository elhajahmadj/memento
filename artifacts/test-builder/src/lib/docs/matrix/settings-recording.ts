import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "settings-recording",
    label: "Recording defaults",
    category: "Admin",
    route: "/admin",
    allowedRoles: ADMIN_ONLY,
    settingsSectionTestId: "recording",
  };

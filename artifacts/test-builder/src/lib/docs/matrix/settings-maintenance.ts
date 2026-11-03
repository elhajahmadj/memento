import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "settings-maintenance",
    label: "Maintenance",
    category: "Tools",
    route: "/tools/maintenance",
    allowedRoles: ADMIN_ONLY,
  };

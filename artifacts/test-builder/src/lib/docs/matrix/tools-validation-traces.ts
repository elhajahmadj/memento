import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "tools-validation-traces",
    label: "Validation traces",
    category: "Tools",
    route: "/tools/validation-traces",
    allowedRoles: ADMIN_ONLY,
  };

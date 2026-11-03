import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "tools-internal-tests",
    label: "Internal tests runner",
    category: "Tools",
    route: "/tools/internal-tests",
    allowedRoles: ADMIN_ONLY,
  };

import type { DocsMatrixEntry } from "../matrix";
import { ANY_ADMIN } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "settings-activity",
    label: "Activity log",
    category: "Tools",
    route: "/tools/activity",
    allowedRoles: ANY_ADMIN,
  };

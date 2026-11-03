import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench",
    label: "Workbench — Recording",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ALL_ROLES,
    requiresProject: true,
  };

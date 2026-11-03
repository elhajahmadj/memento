import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-generate-pipeline-file",
    label: "Workbench — Generate Pipeline File",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ALL_ROLES,
    requiresProject: true,
    // Reuses the existing Workbench toolbar screenshot — the
    // "Generate Pipeline File" item lives in the toolbar's Actions
    // menu (just left of Help), so there is no separate page to
    // capture.
    screenshotKey: "workbench",
  };

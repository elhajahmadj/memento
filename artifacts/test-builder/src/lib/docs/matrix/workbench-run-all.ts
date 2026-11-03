import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-run-all",
    label: "Workbench — Run all tests",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ALL_ROLES,
    requiresProject: true,
    // The Run-all panel is a Workbench side-sheet. The capture harness
    // opens the toolbar's Actions menu and clicks "Validate" to open
    // the sheet before screenshotting — see capture.spec.ts.
  };

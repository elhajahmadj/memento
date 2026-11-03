import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-visual-baseline",
    label: "Workbench — Visual baselines",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ALL_ROLES,
    requiresProject: true,
    // Drives a real recording, opens the Add-assertion dialog, then
    // selects the `Visual baseline` radio so the baseline-name +
    // threshold form is visible — see capture.spec.ts.
  };

import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-accessibility",
    label: "Workbench — Accessibility scans",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ALL_ROLES,
    requiresProject: true,
    // Drives a real recording, opens the Add-assertion dialog, then
    // selects the `Accessibility (axe-core)` radio so the
    // axe-impact dropdown is visible — see capture.spec.ts.
  };

import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-api-checks",
    label: "Workbench — API checks & route mocks",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ALL_ROLES,
    requiresProject: true,
    // Drives a real recording, then opens the Add-API-check dialog
    // (`dialog-add-api-check`) before screenshotting so the doc
    // section depicts the actual editor — see capture.spec.ts.
  };

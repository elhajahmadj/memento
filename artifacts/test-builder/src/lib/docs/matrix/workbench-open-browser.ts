import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-open-browser",
    label: "Workbench — Open Browser (hand-prep before recording)",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ALL_ROLES,
    requiresProject: true,
    // Reuses the shared workbench JPEG — the Open Browser entry lives
    // in the toolbar's Actions menu, so there's no dedicated page to
    // capture. The dedicated dialog state is exercised by the
    // open-browser-recording e2e spec instead.
    screenshotKey: "workbench",
  };

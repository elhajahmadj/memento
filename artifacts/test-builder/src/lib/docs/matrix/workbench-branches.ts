import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-branches",
    label: "Workbench — Branches in the workstation",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ALL_ROLES,
    requiresProject: true,
    // The Explorer panel header carries a `BranchDropdown` next to the
    // "Explorer" label. The capture harness opens the dropdown via
    // `[data-testid="button-branch-dropdown"]` so the screenshot
    // depicts the menu with the current branch + list of local
    // branches + "Create new branch…" affordance visible.
  };

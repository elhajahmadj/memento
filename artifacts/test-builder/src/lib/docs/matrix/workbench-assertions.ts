import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-assertions",
    label: "Workbench — UI assertion catalog",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ALL_ROLES,
    requiresProject: true,
    // The Add-assertion dialog opens from the recorded-actions feed.
    // The capture harness dispatches
    // `recorder:request-open-add-assertion` to surface the dialog
    // before screenshotting — see capture.spec.ts.
  };

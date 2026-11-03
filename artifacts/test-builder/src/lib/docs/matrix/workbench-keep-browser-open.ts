import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-keep-browser-open",
    label: "Workbench — Keep browser open between recordings",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ALL_ROLES,
    requiresProject: true,
    // Two dedicated screenshots: the Start Recording dialog scrolled
    // to the new "Keep browser open after stop recording button is
    // clicked" checkbox (unchecked, fresh-flow), and the same dialog
    // re-opened in attach-to-open-browser mode so the locked Suite +
    // Target controls and the `note-attach-open-browser` banner are
    // visible. The capture step lives in `driveWorkbenchSection`.
    additionalScreenshotKeys: ["workbench-keep-browser-open-attach"],
  };

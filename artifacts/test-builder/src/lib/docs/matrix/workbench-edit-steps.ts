import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-edit-steps",
    label: "Workbench — Edit recorded steps",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ALL_ROLES,
    requiresProject: true,
    // Per-row edit menu lives inside the recorded-actions feed. The
    // capture harness seeds a few mock recorded actions and focuses
    // one so the per-row edit toolbar (rename / move / duplicate /
    // insert / edit / delete) is visible — see capture.spec.ts.
  };

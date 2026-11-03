import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-api-build-test-python",
    label: "Workbench — Build Test (Python)",
    category: "Workspace",
    route: "/workbench",
    // Build Test is admin-only (the api-server route requires Admin),
    // so the dedicated screenshot is too.
    allowedRoles: ADMIN_ONLY,
    requiresProject: true,
    // Loads a Python API solution mid-capture, then opens the Build
    // Test dialog so the screenshot shows step 1 of the Python flow —
    // see `driveWorkbenchSection` in capture.spec.ts.
  };

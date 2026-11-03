import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-api-build-test-java",
    label: "Workbench — Build Test (Java)",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ADMIN_ONLY,
    requiresProject: true,
    // Loads a Java API solution mid-capture, then opens the Build
    // Test dialog — see capture.spec.ts.
  };

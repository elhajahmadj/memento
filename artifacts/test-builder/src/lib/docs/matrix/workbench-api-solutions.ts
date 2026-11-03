import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-api-solutions",
    label: "Workbench — API solutions (multi-language)",
    category: "Workspace",
    route: "/workbench",
    allowedRoles: ALL_ROLES,
    requiresProject: true,
    // Overview / orientation entry. The four language-specific
    // siblings below carry their own dedicated screenshots of the
    // Build Test dialog (Python / Node.js / Java) and the New project
    // dialog with the Language picker open (`home-new-project-api-language`).
    // This entry keeps the shared Workbench JPEG so the overview
    // section depicts the toolbar entry-point that's identical across
    // every language.
    screenshotKey: "workbench",
  };

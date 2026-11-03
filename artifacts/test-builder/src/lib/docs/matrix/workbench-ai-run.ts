import type { DocsMatrixEntry } from "../matrix";
import { ANY_ADMIN } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "workbench-ai-run",
    label: "Workbench — AI run status",
    category: "Workspace",
    route: "/workbench/ai-runs/:projectName/:runId",
    allowedRoles: ANY_ADMIN,
  };

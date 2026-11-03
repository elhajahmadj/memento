import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
  sectionId: "workbench-fix-broken-step",
  label: "Workbench — Fixing a broken step",
  category: "Workspace",
  route: "/workbench",
  allowedRoles: ALL_ROLES,
  requiresProject: true,
};

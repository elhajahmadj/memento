import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "admin-repos-pat",
    label: "Repos PAT",
    category: "Admin",
    // Renders as a collapsible on /admin with testid `repos-pat`. The
    // deep-link /admin/repos-pat bounces here and auto-opens the
    // section, matching the pattern used by the other Source-control
    // entries.
    route: "/admin",
    allowedRoles: ADMIN_ONLY,
    settingsSectionTestId: "repos-pat",
    // Workspace-wide PAT library section. Until the harness ships a
    // dedicated capture step the screenshot reuses the existing
    // Project Git Repos JPEG so the doc page still renders.
    screenshotKey: "admin-git-repos",
  };

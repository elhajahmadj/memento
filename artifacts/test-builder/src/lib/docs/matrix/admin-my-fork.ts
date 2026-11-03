import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "admin-my-fork",
    label: "My fork (personal push target)",
    category: "Admin",
    route: "/admin",
    // Scoped to ADMIN_ONLY because the panel today only renders
    // inside the admin-gated Git Repos editor dialog (Configure /
    // Edit), even though the four `/my-fork` endpoints themselves
    // accept any signed-in user. Follow-up task #63 covers exposing
    // the panel outside the admin dialog; at that point the
    // allowedRoles should widen.
    allowedRoles: ADMIN_ONLY,
    settingsSectionTestId: "git-repos",
  };

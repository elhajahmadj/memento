import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "profile",
    label: "Profile (User info + Password)",
    category: "Account",
    route: "/profile",
    allowedRoles: ALL_ROLES,
  };

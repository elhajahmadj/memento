import type { DocsMatrixEntry } from "../matrix";
import { ANY_ADMIN } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "admin",
    label: "Admin — Overview",
    category: "Admin",
    route: "/admin",
    allowedRoles: ANY_ADMIN,
  };

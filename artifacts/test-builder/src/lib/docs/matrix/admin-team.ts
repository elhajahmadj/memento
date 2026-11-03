import type { DocsMatrixEntry } from "../matrix";
import { ANY_ADMIN } from "./_shared";

export const entry: DocsMatrixEntry = {
  sectionId: "admin-team",
  label: "Managing your team",
  category: "Admin",
  route: "/admin",
  allowedRoles: ANY_ADMIN,
  settingsSectionTestId: "team",
};

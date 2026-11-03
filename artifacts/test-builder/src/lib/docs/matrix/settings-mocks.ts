import type { DocsMatrixEntry } from "../matrix";
import { ANY_ADMIN } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "settings-mocks",
    label: "Network mocks",
    category: "Settings",
    route: "/settings",
    allowedRoles: ANY_ADMIN,
    settingsSectionTestId: "mocks",
  };

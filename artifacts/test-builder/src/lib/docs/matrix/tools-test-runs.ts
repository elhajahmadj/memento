import type { DocsMatrixEntry } from "../matrix";
import { ANY_ADMIN } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "tools-test-runs",
    label: "Test runs history",
    category: "Tools",
    route: "/tools/test-runs",
    allowedRoles: ANY_ADMIN,
  };

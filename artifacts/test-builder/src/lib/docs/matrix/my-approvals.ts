import type { DocsMatrixEntry } from "../matrix";
import { USER_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "my-approvals",
    label: "My submissions",
    category: "Workspace",
    route: "/my-approvals",
    allowedRoles: USER_ONLY,
  };

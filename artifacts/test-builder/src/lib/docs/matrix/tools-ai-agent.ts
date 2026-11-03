import type { DocsMatrixEntry } from "../matrix";
import { ADMIN_ONLY } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "tools-ai-agent",
    label: "AI Agent",
    category: "Tools",
    route: "/tools/ai-agent",
    allowedRoles: ADMIN_ONLY,
  };

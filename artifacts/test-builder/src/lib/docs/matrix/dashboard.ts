import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "dashboard",
    label: "Home — post-login landing",
    category: "Workspace",
    // Dashboard is now the post-login `/` for signed-in users; the
    // public Landing component at `/` is documented separately under
    // `landing` (signed-out capture). `/dashboard` itself still works
    // as a permanent redirect to `/`.
    route: "/",
    allowedRoles: ALL_ROLES,
    // The dashboard renders role-tailored widgets on top of a shared
    // page chrome; the capture harness reuses the existing `home`
    // screenshot so we don't need four separate per-role captures.
    screenshotKey: "home",
  };

import type { DocsMatrixEntry } from "../matrix";
import { ALL_ROLES } from "./_shared";

export const entry: DocsMatrixEntry = {
    sectionId: "landing",
    label: "Landing page (signed out)",
    category: "Workspace",
    // Public marketing surface served from `/` to signed-out visitors.
    // The signed-in equivalent of `/` is documented under `home`.
    route: "/",
    allowedRoles: ALL_ROLES,
    // The capture harness signs out (uses a fresh, cookie-less browser
    // context) before navigating to `/` so the captured JPEG actually
    // shows the public Landing component, not the role-aware Home —
    // see capture.spec.ts.
    screenshotKey: "landing",
  };

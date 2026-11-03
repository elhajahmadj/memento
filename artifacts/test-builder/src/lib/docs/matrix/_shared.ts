import type { AuthUserRole } from "@workspace/api-client-react";
  import { ROLE_PREDICATES, rolesMatching } from "@/features/auth/domain/role";

  // Visibility groups derived from the SHARED role predicates in
  // `@/lib/role`. The same predicates power `useIsAdmin`,
  // `useIsAnyAdmin`, `useIsLimitedAdmin`, so the matrix and the gated
  // pages cannot drift apart.

  /**
   * Every signed-in *account* role. Deliberately EXCLUDES `guest`:
   * the whole `/documentation` surface is hidden from guest trial
   * sessions, so no documented section is visible to them and
   * `entriesForRole("guest")` is empty by construction.
   */
  export const ALL_ROLES: AuthUserRole[] = rolesMatching(ROLE_PREDICATES.nonGuest);
  export const ANY_ADMIN: AuthUserRole[] = rolesMatching(ROLE_PREDICATES.anyAdmin);
  export const ADMIN_ONLY: AuthUserRole[] = rolesMatching(ROLE_PREDICATES.admin);
  export const USER_ONLY: AuthUserRole[] = rolesMatching(ROLE_PREDICATES.limitedUser);

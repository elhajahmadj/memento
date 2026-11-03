import { type ReactNode } from "react";
import { useAuth } from "@/features/auth/presentation/auth-context";
import {
  ROLE_PREDICATES,
  rolesMatching,
  type AuthUserRole,
  type RolePredicate,
} from "@/features/auth/domain/role";
import type { AuthOrganization } from "@workspace/api-client-react";

/**
 * Thin React layer over the pure role/permission rules in
 * `features/auth/domain/role.ts`. The hooks and guard components here
 * are wiring — every actual permission decision is delegated to the
 * domain `ROLE_PREDICATES`. Keep it that way: no policy logic lives in
 * this file.
 */

// Re-export the pure rules so existing callers
// (`@/features/auth/presentation/role`) keep working.
export { ROLE_PREDICATES, rolesMatching };
export type { RolePredicate };

/**
 * Returns the IDP organizations (other than the currently-active one)
 * in which the signed-in user has a per-org role that satisfies
 * `predicate`. The active org is excluded because the prompt is meant
 * to suggest *switching* to a different org; offering to switch to the
 * org you're already in would be confusing.
 *
 * Memento Admin users always satisfy any predicate via `effectiveRole`
 * on the active org, so they never reach the call site (the auto-prompt
 * UI is only rendered when the active org's role fails the gate).
 *
 * Returns an empty list for local username/password users (who have no
 * org memberships) and for SSO users with only one org.
 */
export function useOrgsMatchingRole(
  predicate: RolePredicate,
): AuthOrganization[] {
  const { organizations, activeOrganizationId } = useAuth();
  // Guard against partial auth-context shapes (e.g. in tests that only
  // mock `user`/`loading`): treat a missing list as "no qualifying
  // orgs" instead of crashing the page that consumes this hook.
  const list = organizations ?? [];
  return list.filter(
    (o) => o.id !== activeOrganizationId && predicate(o.role ?? null),
  );
}

export function useRole(): AuthUserRole | null {
  const { user } = useAuth();
  // `effectiveRole` is the server-resolved role for the *currently
  // active* org (precedence: memento_admin > local-user global role >
  // per-org membership role > null). It is null for SSO users with no
  // active org or no matching membership row, which the gating layer
  // intentionally treats as "no authority". We never fall back to
  // `user.role` here — that field is the raw row value and is the
  // neutral `limited` baseline for SSO users, which would silently
  // grant non-admin UI to users whose per-org role hasn't loaded yet.
  if (!user) return null;
  return user.effectiveRole ?? null;
}

// Strict admin check — only the full "admin" role (or god-mode Memento
// Admin) passes. Use this for admin-only UI like the user-management
// page or the assignment editor.
export function useIsAdmin(): boolean {
  return ROLE_PREDICATES.admin(useRole());
}

// Limited-admin only — useful for "you are scoped to assigned projects"
// banners and the request-access flow.
export function useIsLimitedAdmin(): boolean {
  return ROLE_PREDICATES.limitedAdmin(useRole());
}

// True for either flavour of admin (full or limited). Use for shared
// admin-style UI (home page layout, fork-requests page, approvals page).
export function useIsAnyAdmin(): boolean {
  return ROLE_PREDICATES.anyAdmin(useRole());
}

// Strict Memento Admin (god-mode) check — true only for the
// `memento_admin` role. Use for UI that should only ever show to
// Memento Admins (e.g. cross-org banners or god-mode badges).
export function useIsMementoAdmin(): boolean {
  return ROLE_PREDICATES.mementoAdmin(useRole());
}

/**
 * True for a throwaway "Continue as guest" trial identity.
 *
 * Use this to HIDE what guests can't have — AI affordances, setup
 * surfaces, collaboration flows — not to grant anything. The real
 * enforcement is the server-side allow-list in
 * `shared/middlewares/guestAllowlist.ts`; this hook exists so guests
 * aren't shown buttons that would only 403.
 */
export function useIsGuest(): boolean {
  return ROLE_PREDICATES.guest(useRole());
}

/** Inverse of {@link useIsGuest} for any signed-in non-guest account. */
export function useIsNonGuest(): boolean {
  return ROLE_PREDICATES.nonGuest(useRole());
}

export function RequireRole({
  role,
  fallback = null,
  children,
}: {
  role: AuthUserRole;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const current = useRole();
  if (current !== role) return <>{fallback}</>;
  return <>{children}</>;
}

export function AdminOnly({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RequireRole role="admin" fallback={fallback}>
      {children}
    </RequireRole>
  );
}

// Either flavour of admin sees the children.
export function AnyAdminOnly({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const isAny = useIsAnyAdmin();
  if (!isAny) return <>{fallback}</>;
  return <>{children}</>;
}

// Memento Admin (god-mode) only sees the children.
export function MementoAdminOnly({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const isMa = useIsMementoAdmin();
  if (!isMa) return <>{fallback}</>;
  return <>{children}</>;
}

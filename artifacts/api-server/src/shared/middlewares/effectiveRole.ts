import { type Request } from "express";
import {
  resolveEffectiveRole,
  type EffectiveRole,
} from "@/features/auth/domain/effectiveRole";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Cached per-request effective role, populated lazily by
       * {@link getEffectiveRole}. Use the helper rather than reading
       * this property directly so unauthenticated / unresolved
       * requests are handled consistently.
       *
       * `undefined` = not yet resolved on this request.
       * `null`      = resolved, but caller has no effective role
       *               (SSO user with no active org, or whose active
       *               org is no longer a membership).
       */
      _effectiveRole?: EffectiveRole | null;
    }
  }
}

/**
 * Resolve the caller's *effective* memento role for the current
 * request, caching the answer on the request object so repeat reads
 * don't issue redundant DB lookups.
 *
 * Delegates to {@link resolveEffectiveRole} which encodes the
 * per-org-roles precedence (memento_admin > local users.role >
 * user_organizations.role for the active org).
 *
 * Returns `null` when the caller has no resolvable role today —
 * typically an SSO user who has not yet picked an active org, or
 * whose previously-active org was revoked by the IDP. Route guards
 * should translate this to a clear 403.
 */
export async function getEffectiveRole(
  req: Request,
): Promise<EffectiveRole | null> {
  if (req._effectiveRole !== undefined) return req._effectiveRole;
  if (!req.user) {
    req._effectiveRole = null;
    return null;
  }
  const role = await resolveEffectiveRole(
    req.user,
    req.session.activeOrgId ?? null,
  );
  req._effectiveRole = role;
  return role;
}

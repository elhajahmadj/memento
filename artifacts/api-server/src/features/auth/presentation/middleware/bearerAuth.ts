import { type Request, type Response, type NextFunction } from "express";
import { logger } from "@/shared/logger";
import { listOrgsForUser } from "@/features/auth/infrastructure/oidcProvider";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Raw Nexus OAuth2 access token presented by the caller in
       * `Authorization: Bearer <token>`. Set by {@link bearerAuth} on
       * a successful verification so downstream handlers (currently
       * the IDP-provisioning routes) can forward the token to Nexus
       * without re-parsing the header. Absent for session-cookie
       * callers — those handlers should fall back to
       * `req.session.oidcAccessToken`.
       */
      nexusAccessToken?: string;
    }
  }
}
import {
  getOidcConfig,
  isOidcEnabled,
} from "@/features/auth/infrastructure/oidcConfig";
import { getContainer } from "@/composition/container";

/**
 * Authenticate `/api/*` requests that carry an `Authorization: Bearer
 * <nexus_access_token>` header. Runs *before* the session-based
 * `requireAuth` so machine-to-machine callers (and humans armed with a
 * Nexus token) don't need a session cookie.
 *
 * Delegates to the `VerifyBearerTokenUseCase` resolved from the
 * composition container so verification, /userinfo enrichment, and
 * provisioning all flow through the same ports/adapters wiring as the
 * SSO callback.
 *
 * Behavior:
 * - No `Authorization: Bearer` header → no-op, fall through to the
 *   existing session check.
 * - Header present but Nexus is not configured → no-op (the operator
 *   hasn't opted in to SSO; ignore the token rather than 401-ing
 *   callers who happen to send one).
 * - Header present and Nexus is configured → run the use case. On
 *   success, attach `req.user` + `req.nexusAccessToken` and call
 *   `next()`. On any failure, reject with `401` — never fall through,
 *   since a presented-but-invalid token is an explicit auth attempt
 *   and silently succeeding via session would mask the failure.
 */
export async function bearerAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !/^Bearer\s+/i.test(header)) {
    next();
    return;
  }
  if (!isOidcEnabled()) {
    next();
    return;
  }
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    res.status(401).json({ error: "Invalid bearer token" });
    return;
  }
  const cfg = getOidcConfig()!;
  const result = await getContainer().useCases.auth.verifyBearerToken.execute({
    token,
    orgClaim: cfg.orgClaim,
    rolesClaim: cfg.rolesClaim,
    userClaimsNamespace: cfg.userClaimsNamespace,
    mementoUserClaim: cfg.mementoUserClaim,
    mementoAccessClaim: cfg.mementoAccessClaim,
    mementoGodModeAccessClaim: cfg.mementoGodModeAccessClaim,
    mementoGodModeRoleClaim: cfg.mementoGodModeRoleClaim,
    mementoGodModeRoleValue: cfg.mementoGodModeRoleValue,
    mementoGodModeTierClaim: cfg.mementoGodModeTierClaim,
    mementoGodModeTierValue: cfg.mementoGodModeTierValue,
  });
  if (result.kind === "err") {
    logger.warn({ err: result.error }, "Rejected bearer token");
    res.status(401).json({ error: result.error.message });
    return;
  }
  req.user = result.value.user;
  req.nexusAccessToken = token;
  // Mirror the SSO callback's sole-org auto-pick so a bearer-only caller
  // (no session cookie, hence no prior org pick) resolves an effective
  // role on `/auth/me`. Memento Admins bypass the per-org gate entirely,
  // so we leave their active org unset.
  if (
    result.value.user.role !== "memento_admin" &&
    req.session &&
    !req.session.activeOrgId
  ) {
    try {
      const orgs = await listOrgsForUser(result.value.user.id);
      if (orgs.length === 1 && orgs[0]) {
        req.session.activeOrgId = orgs[0].id;
      }
    } catch (e) {
      logger.warn({ err: e }, "bearerAuth: failed to auto-pick sole org");
    }
  }
  next();
}

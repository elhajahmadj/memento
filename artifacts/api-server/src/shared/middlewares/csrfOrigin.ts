import { type Request, type Response, type NextFunction } from "express";
import { isOriginAllowed } from "@/shared/security/origins";

/**
 * CSRF defense for state-changing requests (audit finding C-3).
 *
 * Why a CORS allow-list is not sufficient on its own: CORS governs
 * whether the *response* may be read, not whether the request runs. A
 * cross-origin "simple" request — `POST` with a form-ish content type —
 * is dispatched by the browser, reaches the handler, and commits its
 * side effect; the browser only withholds the response afterwards. For a
 * mutation, the damage is already done by then.
 *
 * `SameSite=Lax` on the session cookie is the primary control (the
 * cookie simply is not attached cross-site). This middleware is the
 * second layer, and covers the cases SameSite does not: same-site but
 * different-origin attackers (e.g. a subdomain takeover), and clients
 * where the cookie policy behaves unexpectedly.
 *
 * Chosen over a synchronizer/double-submit token deliberately. A token
 * would need to be threaded through `customFetch` *and* the handful of
 * raw `fetch()` call sites in the SPA (guest sign-in, SSO logout, SSO
 * admin-contacts, request-access, post-login redirect), so it carries
 * real breakage risk for a marginal gain over this check. Browsers send
 * `Origin` on every mutating request — including same-origin ones — so
 * an allow-list check is both sufficient and invisible to correct
 * clients.
 *
 * Non-browser callers (curl, CI, bearer-token machine-to-machine) send
 * no `Origin` at all and are unaffected: `isOriginAllowed` treats a
 * missing origin as allowed. That is not a bypass — CSRF requires a
 * browser, and browsers always send it.
 */

/** Methods that cannot change server state and so need no CSRF check. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  if (isOriginAllowed(req.headers.origin, req.headers.host)) {
    next();
    return;
  }

  req.log?.warn(
    { origin: req.headers.origin, method: req.method, path: req.path },
    "rejected state-changing request from a disallowed origin",
  );
  res.status(403).json({
    error: "Request origin is not allowed.",
    code: "ORIGIN_FORBIDDEN",
  });
}

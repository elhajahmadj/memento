import { type Request, type Response, type NextFunction } from "express";
import { type User } from "@workspace/db";
import { getAuthProvider } from "@/features/auth/infrastructure/authProvider";
import { findActiveGuestSession } from "@/features/guest/infrastructure/guestSessionService";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const ALLOWLIST: ReadonlyArray<{ method: string; path: string }> = [
  { method: "GET", path: "/healthz" },
  { method: "POST", path: "/auth/login" },
  { method: "GET", path: "/auth/me" },
  // Dev-only fast user switch; the route itself returns 404 outside dev.
  { method: "GET", path: "/auth/dev-login" },
  // OIDC SSO endpoints — both are part of the unauthenticated login
  // flow (the user's session is established by the callback). The
  // routes themselves return 404 when SSO isn't configured.
  { method: "GET", path: "/auth/sso/login" },
  { method: "GET", path: "/auth/sso/callback" },
  // The SSO admin-contacts and request-access endpoints back the
  // unauthenticated `/login` deny banner — a denied user has no
  // session by definition.
  { method: "GET", path: "/auth/sso/admin-contacts" },
  { method: "POST", path: "/auth/sso/request-access" },
  // "Continue as guest" mints its own throwaway identity, so by
  // definition the caller has no session yet.
  { method: "POST", path: "/auth/guest" },
  // Dev-only static HTML fixture used by the docs-screenshot harness as a
  // recorder startUrl so a real recording can drive the workbench feed.
  // The route itself returns 404 outside dev, so production never exposes
  // it; it must be unauthenticated because the recorder Chromium that
  // fetches it has no session cookie.
  { method: "GET", path: "/recording/dev-fixture-login" },
];

function isAllowlisted(req: Request): boolean {
  // Note: when this middleware is mounted on a router that itself is mounted
  // at `/api`, `req.path` reflects the path within that router (e.g.
  // `/auth/login`), so the allow-list entries are written without the `/api`
  // prefix.
  return ALLOWLIST.some(
    (entry) => entry.method === req.method && entry.path === req.path,
  );
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (isAllowlisted(req)) {
    next();
    return;
  }

  // Bearer-token middleware (mounted before us) may have already
  // authenticated the request and set `req.user`. Honor that so callers
  // with a valid Nexus access token don't need a session cookie.
  if (req.user) {
    next();
    return;
  }

  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await getAuthProvider().findUserById(userId);
  if (!user) {
    req.session.destroy(() => {
      res.status(401).json({ error: "Unauthorized" });
    });
    return;
  }

  // Guest trial identities expire on a hard deadline. The reaper sweeps
  // every few minutes, so between the deadline and the next sweep the
  // `users` row still resolves — check the deadline on every request to
  // close that window. A guest row with no matching (unexpired)
  // `guest_sessions` entry is treated as signed out.
  if (user.role === "guest") {
    const guest = await findActiveGuestSession(user.id);
    if (!guest) {
      req.session.destroy(() => {
        res
          .status(401)
          .json({ error: "Your guest session has expired.", code: "GUEST_EXPIRED" });
      });
      return;
    }
  }

  req.user = user;
  next();
}

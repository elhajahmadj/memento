import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { type RequestHandler } from "express";
import { pool } from "@workspace/db";

declare module "express-session" {
  interface SessionData {
    /**
     * Epoch ms when this session was established. Backs the absolute
     * lifetime cap (audit finding L-5) that `rolling: true` cannot
     * extend. Stamped lazily so sessions created before that cap
     * existed are not all invalidated on deploy.
     */
    createdAt?: number;
    userId?: string;
    /**
     * The organization the IDP user is currently acting in. Null /
     * absent for local username/password users — they have no orgs.
     * Set automatically after SSO login when the user belongs to
     * exactly one org, or after `POST /api/auth/active-org` when they
     * pick from a multi-org list.
     */
    activeOrgId?: string | null;
    /**
     * In-flight OIDC PKCE state. Written by `/api/auth/sso/login`
     * before redirecting to the IDP and consumed once at
     * `/api/auth/sso/callback`. Always cleared after use.
     */
    oidcState?: string;
    oidcCodeVerifier?: string;
    /**
     * Tokens carried for the duration of an OIDC session so we can
     * (a) refresh the access token without bouncing the user back
     * through the browser flow, and (b) end the IDP session at logout
     * via `id_token_hint`. All three are absent for local users.
     */
    oidcIdToken?: string;
    oidcAccessToken?: string;
    oidcRefreshToken?: string;
    /** Unix epoch ms when the access token expires. */
    oidcAccessTokenExpiresAt?: number;
  }
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Absolute session lifetime (audit finding L-5).
 *
 * `rolling: true` refreshes the cookie's expiry on every request, so a
 * continuously-active session never expired — a stolen cookie stayed
 * valid indefinitely as long as it kept being used, and there was no
 * server-side revocation short of explicit logout. This is the ceiling
 * that `rolling` cannot extend: 24 hours after the session was created,
 * it is destroyed regardless of activity and the user signs in again.
 *
 * Note this is deliberately independent of the OIDC access-token
 * lifetime, which is refreshed separately (`refreshOidcSessionIfNeeded`)
 * and so does not bound the local session on its own.
 */
const ABSOLUTE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let cached: RequestHandler | null = null;

/**
 * Enforce {@link ABSOLUTE_SESSION_MAX_AGE_MS}. Runs after the session
 * middleware. Stamps `createdAt` on first sight so pre-existing sessions
 * get a lifetime from this deploy forward rather than being logged out
 * en masse the moment it ships.
 */
export function enforceAbsoluteSessionLifetime(): RequestHandler {
  return (req, res, next) => {
    const sess = req.session as typeof req.session & { createdAt?: number };
    if (!sess || !req.session.userId) {
      next();
      return;
    }
    if (typeof sess.createdAt !== "number") {
      sess.createdAt = Date.now();
      next();
      return;
    }
    if (Date.now() - sess.createdAt < ABSOLUTE_SESSION_MAX_AGE_MS) {
      next();
      return;
    }
    req.session.destroy(() => {
      res.clearCookie("tb.sid", { path: "/" });
      // 401 rather than a redirect: every consumer of this API is the
      // SPA's fetch layer, which already handles 401 by returning the
      // user to the login page.
      res.status(401).json({
        error: "Your session has expired. Please sign in again.",
        code: "SESSION_EXPIRED",
      });
    });
  };
}

export function buildSessionMiddleware(): RequestHandler {
  if (cached) return cached;
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required.");
  }

  const PgStore = connectPgSimple(session);

  cached = session({
    store: new PgStore({
      pool,
      tableName: "user_sessions",
    }),
    name: "tb.sid",
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      /**
       * C-3: was `"none"`, which tells the browser to attach this cookie
       * on cross-site requests and so removes the browser's own CSRF
       * protection. `"lax"` is safe here because the SPA is always
       * same-origin with the API — `setBaseUrl()` is never called, so
       * every client request uses a relative URL against whichever
       * origin served the app. Same-origin requests attach the cookie
       * regardless of SameSite, so nothing legitimate changes; genuine
       * cross-site POSTs stop carrying the session.
       *
       * `shared/middlewares/csrfOrigin.ts` is the second layer for the
       * cases SameSite does not cover.
       */
      sameSite: "lax",
      secure: true,
      maxAge: ONE_WEEK_MS,
      path: "/",
    },
  });
  return cached;
}

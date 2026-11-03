import { type Request, type Response, type NextFunction } from "express";

/**
 * Deny-by-default API surface for guest ("Continue as guest") trial
 * identities.
 *
 * This is intentionally an ALLOW-list, not a block-list. A block-list
 * fails open: every endpoint added after this file was written would be
 * silently reachable by guests until someone remembered to deny it. An
 * allow-list fails closed — a new route is invisible to guests until it
 * is deliberately opened here.
 *
 * Non-guest callers are not touched at all: the middleware short-
 * circuits unless `req.user.role === "guest"`, so mounting it changes
 * no existing behavior.
 *
 * Paths are matched *within* the `/api` router, so they are written
 * without the `/api` prefix — same convention as the `requireAuth`
 * allow-list. Express params (`:id`) are matched with a single-segment
 * wildcard so the rules read like the route declarations they mirror.
 */

interface GuestRule {
  /** HTTP methods this rule opens. */
  methods: readonly string[];
  /**
   * Route pattern. `:name` matches exactly one path segment; a trailing
   * `/*` matches the prefix and everything below it. Anything else must
   * match exactly.
   */
  path: string;
}

const GET = ["GET"] as const;
const GET_POST = ["GET", "POST"] as const;
const ALL = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * What a guest is allowed to do: sign out, set their own appearance
 * preference, create/open/export exactly one project, record against it
 * (UI, API, or JMX performance), heal selectors deterministically, and
 * validate what they recorded.
 *
 * Notable deliberate omissions, each of which 403s:
 *  - `/ai-agent/*` and `/selectors/heal/ai-*` — no AI features.
 *  - `/settings/*`, `/route-mocks/*`, `/shared-steps/*`,
 *    `/architectures` writes — the "setup" surfaces. Appearance is the
 *    one exception and lives under `/users/me/preferences`.
 *  - `/admin/*`, `/users/*` beyond own preferences, `/audit`,
 *    `/repo-pats`, `/team/*`, `/nexus-config/*`, `/sso-*`.
 *  - `/forks/*`, `/approvals/*`, `/project-assignments/*`,
 *    `/project-access-requests/*` — collaboration flows that assume a
 *    real account and an approving admin.
 *  - `/projects/delete`, `/projects/clear-files`, `/projects/disable`,
 *    `/projects/clone`, `/projects/lifecycle-requests/*`, and every
 *    `git-config` / `branches` route.
 *  - `/api-tests/build` and `/projects/demo`, which are already
 *    admin-only for regular users.
 */
const GUEST_ALLOWLIST: readonly GuestRule[] = [
  // --- Identity ---------------------------------------------------
  { methods: GET, path: "/healthz" },
  { methods: GET, path: "/auth/me" },
  { methods: ["POST"], path: "/auth/logout" },
  { methods: ["POST"], path: "/auth/guest" },
  // Appearance (theme + nav layout) is the one Settings surface guests
  // keep, and it is served from the users feature rather than
  // `/settings/*`.
  { methods: ["GET", "PUT"], path: "/users/me/preferences" },
  // Guests are minted with `hasSeenTour: true`, but the SPA still
  // probes tour state on mount; allow it so the console isn't noisy.
  { methods: GET_POST, path: "/users/me/tour-state" },
  { methods: ["POST"], path: "/users/me/tour-seen" },

  // --- Projects ---------------------------------------------------
  // `POST /projects` is additionally capped at one project per guest
  // inside the route handler.
  { methods: ["POST"], path: "/projects" },
  { methods: GET, path: "/projects/current" },
  { methods: ["POST"], path: "/projects/load" },
  { methods: GET, path: "/projects/available" },
  { methods: GET, path: "/projects/tree" },
  { methods: GET, path: "/projects/zip" },
  { methods: GET, path: "/projects/api-base-urls" },
  { methods: GET, path: "/tests" },
  { methods: GET, path: "/projects/:projectId/tests" },

  // --- Architectures (read-only) ----------------------------------
  // The New Project dialog needs the built-in defaults to populate its
  // picker. Every write (create / update / delete / import / preview)
  // stays closed, including `POST /architectures/delete`.
  { methods: GET, path: "/architectures" },
  { methods: GET, path: "/architectures/:id" },

  // --- Recording, codegen, files ----------------------------------
  { methods: ALL, path: "/recording/*" },
  { methods: ALL, path: "/jmx/recording/*" },
  { methods: ["POST"], path: "/codegen/test-class" },
  { methods: ["POST"], path: "/codegen/test-method" },
  { methods: ALL, path: "/files" },
  { methods: ["POST"], path: "/files/rename" },
  { methods: ALL, path: "/folders" },
  // "Reuse logged-in session" in the recorder.
  { methods: GET, path: "/auth-state" },
  { methods: ["POST"], path: "/auth-state/save" },

  // --- Selector healing (deterministic only) ----------------------
  // `/selectors/heal/ai-available` and `/selectors/heal/ai-suggest` are
  // intentionally absent — listing the concrete paths rather than a
  // `/selectors/heal/*` wildcard is what keeps them closed.
  { methods: ["POST"], path: "/selectors/heal" },
  { methods: ["POST"], path: "/selectors/heal/repick/start" },
  { methods: ["POST"], path: "/selectors/heal/repick/pick" },
  { methods: ["POST"], path: "/selectors/heal/repick/refresh" },
  { methods: ["POST"], path: "/selectors/heal/repick/cancel" },

  // --- Validation --------------------------------------------------
  { methods: GET, path: "/validation/recordings" },
  { methods: GET_POST, path: "/validation/runs" },
  { methods: GET, path: "/validation/runs/:id" },
  { methods: GET, path: "/validation/runs/:id/screenshot" },
  { methods: GET, path: "/validation/runs/:id/trace" },
  { methods: GET, path: "/validation/runs/:id/visual-diff" },
  { methods: GET_POST, path: "/projects/:projectId/runs/by-selection" },
  { methods: GET, path: "/projects/:projectId/runs/by-selection/:runId" },

  // --- Dashboard ---------------------------------------------------
  { methods: GET, path: "/dashboard/summary" },
] as const;

/**
 * Match a route pattern against a concrete path. `:name` consumes one
 * segment; a trailing `/*` consumes the rest.
 */
function pathMatches(pattern: string, actual: string): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return actual === prefix || actual.startsWith(`${prefix}/`);
  }
  const patternParts = pattern.split("/");
  const actualParts = actual.split("/");
  if (patternParts.length !== actualParts.length) return false;
  return patternParts.every((part, i) => {
    if (part.startsWith(":")) return actualParts[i] !== "";
    return part === actualParts[i];
  });
}

/** True when a guest may call `method path`. Exported for tests. */
export function isGuestAllowed(method: string, path: string): boolean {
  // Normalize a trailing slash so `/files/` and `/files` behave alike.
  const normalized =
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return GUEST_ALLOWLIST.some(
    (rule) =>
      rule.methods.includes(method.toUpperCase()) &&
      pathMatches(rule.path, normalized),
  );
}

/**
 * Mounted immediately after `requireAuth`. Rejects any request from a
 * guest that is not explicitly allow-listed above.
 */
export function guestAllowlist(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.user?.role !== "guest") {
    next();
    return;
  }
  if (isGuestAllowed(req.method, req.path)) {
    next();
    return;
  }
  res.status(403).json({
    error:
      "This feature isn't available in a guest session. Sign in with an " +
      "account to use it.",
    code: "GUEST_FORBIDDEN",
  });
}

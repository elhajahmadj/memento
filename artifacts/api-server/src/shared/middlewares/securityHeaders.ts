import { type Request, type Response, type NextFunction } from "express";

/**
 * Security response headers (audit finding H-7).
 *
 * In production this process also serves the built SPA, so the app's own
 * HTML was being delivered with no CSP, no framing protection, no HSTS,
 * and no MIME-sniffing protection — removing every safety net beneath
 * the rest of the security model.
 *
 * Hand-rolled rather than pulling in `helmet`: the set of headers that
 * actually matters here is small, the values are deployment-specific
 * (the CSP has to allow the screencast's `data:`/`blob:` frames and the
 * recorder's WebSocket), and being explicit means a reader can see
 * exactly what is sent. If this grows, `helmet` is the right next step.
 */

/**
 * Content-Security-Policy for the SPA.
 *
 * - `script-src 'self'` — the Vite bundle is same-origin. No inline
 *   scripts, no eval.
 * - `style-src` needs `'unsafe-inline'`: the UI sets inline `style`
 *   attributes (panel sizing, Tailwind arbitrary values), which cannot
 *   be nonce'd without reworking the components.
 * - `img-src` needs `data:` and `blob:` — the live screencast renders
 *   base64 PNG/JPEG frames straight into an `<img>`.
 * - `connect-src` needs `ws:`/`wss:` for the three WebSocket routes.
 * - `frame-ancestors 'none'` is the CSP form of X-Frame-Options and is
 *   the directive modern browsers actually honor.
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const ONE_YEAR_SECONDS = 31_536_000;

/**
 * Whether to enforce the CSP or only report violations.
 *
 * Defaults to **report-only**. A CSP that is subtly wrong breaks the UI
 * in ways that are invisible server-side, so the safe rollout is to ship
 * it in report-only mode, confirm the browser console is clean against
 * the real app, then set `CSP_ENFORCE=1`. The other headers here carry
 * no such risk and are always enforced.
 */
function cspHeaderName(): string {
  const flag = (process.env.CSP_ENFORCE ?? "").trim().toLowerCase();
  const enforce = flag === "1" || flag === "true" || flag === "yes";
  return enforce
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
}

export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // No feature of this app needs these, so deny them outright.
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(cspHeaderName(), CSP_DIRECTIVES);

  // HSTS only over HTTPS. `trust proxy` is set, so `req.secure` reflects
  // the Fly edge's X-Forwarded-Proto rather than the internal hop.
  // Sending it over plain HTTP is meaningless and would pin localhost
  // to HTTPS during local development.
  if (req.secure) {
    res.setHeader(
      "Strict-Transport-Security",
      `max-age=${ONE_YEAR_SECONDS}; includeSubDomains`,
    );
  }

  next();
}

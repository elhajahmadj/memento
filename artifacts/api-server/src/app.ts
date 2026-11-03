import path from "node:path";
import { existsSync } from "node:fs";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "@/routes";
import { logger } from "@/shared/logger";
import {
  buildSessionMiddleware,
  enforceAbsoluteSessionLifetime,
} from "@/shared/middlewares/session";
import { securityHeaders } from "@/shared/middlewares/securityHeaders";
import { csrfOrigin } from "@/shared/middlewares/csrfOrigin";
import { isOriginAllowed } from "@/shared/security/origins";
import { isDevEnvironment } from "@/features/auth/infrastructure/devEnvironment";

/**
 * Request body limits. The API is JSON-only and its largest legitimate
 * payloads are recorded action sets and captured Playwright storage
 * state, both comfortably inside this bound.
 */
const JSON_BODY_LIMIT = "1mb";
const FORM_BODY_LIMIT = "64kb";

/**
 * How many reverse-proxy hops to trust for `X-Forwarded-*` (audit
 * finding L-6).
 *
 * `1` is correct behind Fly's edge, which is how this is deployed, and
 * it is what makes `req.secure` and `req.ip` meaningful — the latter now
 * matters more than it used to, because the rate limiter (H-3) keys off
 * it. The risk is the mirror image: if the process is ever reachable
 * *without* the proxy in front, a client can spoof `X-Forwarded-For` and
 * defeat per-IP limiting. Configurable so a deployment that terminates
 * differently (or none at all) can say so instead of inheriting an
 * assumption.
 */
function trustProxyHops(): number {
  const raw = (process.env.TRUST_PROXY_HOPS ?? "").trim();
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 1;
  return parsed;
}

const app: Express = express();
app.set("trust proxy", trustProxyHops());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(securityHeaders);

// C-3: this used to be `origin: (origin, cb) => cb(null, origin ?? true)`
// with `credentials: true` — i.e. reflect ANY origin and allow cookies,
// which lets any website read authenticated API responses. The origin is
// now matched against an explicit allow-list and never reflected.
//
// In production the SPA is served same-origin from this very process, so
// no configuration is normally needed; `CORS_ALLOWED_ORIGINS` exists
// mainly for local development. Shares its policy with the WebSocket
// upgrade guard so the two cannot drift.
app.use(
  cors({
    origin: (origin, cb) => cb(null, isOriginAllowed(origin)),
    credentials: true,
  }),
);

// M-9: state the body limits rather than inheriting the implicit 100 kB
// default. `body-parser` has an advisory whose failure mode is "an
// invalid limit silently disables enforcement", so being explicit is
// also a hedge against that going unnoticed.
app.use(express.json({ limit: JSON_BODY_LIMIT }));
// L-4: `extended: false` drops the `qs` nested-object parser. The API is
// JSON-only; this parser is kept solely so a stray form post produces a
// clean 400 rather than an unparsed body.
app.use(express.urlencoded({ extended: false, limit: FORM_BODY_LIMIT }));

app.use(buildSessionMiddleware());
// L-5: absolute lifetime ceiling that `rolling: true` cannot extend.
app.use(enforceAbsoluteSessionLifetime());

// Must run after the session middleware (so `req.log` and the session
// exist) and before the router, so no handler can commit a side effect
// for a cross-origin caller.
app.use(csrfOrigin);

app.use("/api", router);

app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const e = err as Error & { code?: string; detail?: string; type?: string };
    req.log.error(
      {
        err: { type: e?.constructor?.name, message: e?.message, stack: e?.stack, code: e?.code, detail: e?.detail },
        url: req.url,
      },
      "unhandled route error",
    );
    if (res.headersSent) return;

    // A body that exceeded the configured limit is the caller's fault,
    // not a server fault — report it as 413 so clients can react, and
    // so it doesn't pollute the 500 rate.
    if (e?.type === "entity.too.large") {
      res.status(413).json({
        error: "Request body too large.",
        code: "BODY_TOO_LARGE",
      });
      return;
    }

    // Likewise a body the parser could not read: a malformed request is
    // a 400, and reporting it as 500 both misleads the caller and hides
    // real server faults in the same bucket. The parser's message is
    // deliberately not echoed — it quotes the offending input.
    if (e?.type === "entity.parse.failed") {
      res.status(400).json({
        error: "Request body could not be parsed.",
        code: "BODY_MALFORMED",
      });
      return;
    }

    // H-4: this used to return `message: e.message`. For a Postgres
    // error surfacing through Drizzle that message names the failing
    // constraint, column and table; for a filesystem error it leaks an
    // absolute container path; for the crypto helpers it names the env
    // var. All of it was remotely harvestable by sending malformed
    // requests. Return an opaque body plus the request id, and keep the
    // detail in the log where it is correlated by that same id.
    //
    // Verbose messages stay available in development, where they are
    // genuinely useful and there is no attacker to inform.
    const body: Record<string, unknown> = {
      error: "Internal Server Error",
      requestId: req.id,
    };
    if (isDevEnvironment()) {
      body["message"] = e?.message ?? String(err);
    }
    res.status(500).json(body);
  },
);

// In production, the same Express process also serves the built
// test-builder SPA so a single Fly machine can serve both `/` (the
// React app) and `/api/*` (this server) on one port. The path is
// configurable so the Dockerfile (or any other host) can point at
// wherever the static bundle ended up.
if (process.env.NODE_ENV === "production") {
  const spaDir =
    process.env.SPA_DIST_DIR ??
    path.resolve(process.cwd(), "artifacts/test-builder/dist/public");
  const indexHtml = path.join(spaDir, "index.html");

  if (!existsSync(indexHtml)) {
    logger.warn(
      { spaDir },
      "SPA bundle not found; the API will run without serving the test-builder. Set SPA_DIST_DIR or build @workspace/test-builder.",
    );
  } else {
    logger.info({ spaDir }, "Serving test-builder SPA from disk");
    app.use(
      express.static(spaDir, {
        index: false,
        maxAge: "1h",
      }),
    );
    app.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
      // Never let the SPA fallback hijack API or WebSocket routes —
      // those should 404 through Express, not return index.html.
      // Match exact prefixes only, so unrelated paths like `/apiary`
      // still resolve to the SPA.
      const p = req.path;
      if (p === "/api" || p.startsWith("/api/")) return next();
      if (p === "/ws" || p.startsWith("/ws/")) return next();
      res.sendFile(indexHtml);
    });
  }
}

export default app;

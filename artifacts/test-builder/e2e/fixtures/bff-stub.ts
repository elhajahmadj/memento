/**
 * Stub BFF + IdP + Upstream HTTP servers used by the
 * `jmx-bff-recording.spec.ts` end-to-end test (task #17). Three tiny
 * `node:http` servers listen on ephemeral 127.0.0.1 ports so the
 * api-server's headless recorder Chromium can drive a complete
 * BFF-style OAuth + CSRF dance against them:
 *
 *   - **BFF**       — the user's own backend-for-frontend origin.
 *                     `/start` sets a non-HttpOnly `XSRF-TOKEN` cookie
 *                     and returns a small HTML page. `/callback`
 *                     returns HTML whose inline `<script>` echoes the
 *                     cookie into an `X-XSRF-TOKEN` request header on
 *                     `/api/protected` (the double-submit consumer the
 *                     CSRF detector pattern-matches), then makes a
 *                     cross-origin GET to the upstream API.
 *   - **IdP**       — `/authorize?response_type=code&state=...&nonce=...
 *                     &client_id=bff&redirect_uri=BFF/callback` 302s
 *                     to BFF/callback?code=...&state=... so the OAuth
 *                     detector sees both the authorize event (carries
 *                     `response_type=code`) and the callback event
 *                     (carries `code=`), with the literal `state` /
 *                     `code` values visible on the authorize event's
 *                     `Location` response header for the Regex
 *                     Extractor.
 *   - **Upstream**  — `/v1/widgets` returns JSON with permissive CORS
 *                     so the cross-origin fetch from the callback
 *                     page succeeds (the request itself is what the
 *                     recorder captures — its body is irrelevant).
 *
 * Listens on 127.0.0.1 with port 0 so the test never collides with a
 * fixed port. Returns the chosen URLs + an async `close()` so the
 * spec can tear them down in `afterAll`.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface BffStubUrls {
  bffUrl: string;
  idpUrl: string;
  upstreamUrl: string;
  /** Literal CSRF token value set on the XSRF-TOKEN cookie. */
  csrfToken: string;
  /** Literal OAuth `state` echoed back on the callback redirect. */
  state: string;
  /** Literal OAuth `code` echoed back on the callback redirect. */
  code: string;
}

export interface BffStub {
  urls: BffStubUrls;
  close: () => Promise<void>;
}

/**
 * Listen on `127.0.0.1:0` (kernel picks a free port) and resolve once
 * the server is accepting connections. Returns the chosen port.
 */
function listenOnEphemeralPort(server: Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

/**
 * Spin up the three stub servers. Caller is responsible for calling
 * `close()` (typically from a Playwright `afterAll` hook).
 */
export async function startBffStub(): Promise<BffStub> {
  const csrfToken = "TOK_a1b2c3d4e5f6g7h8";
  const state = "ST_state_9z8y7x6w5v4u";
  const code = "CD_code_1m2n3o4p5q6r";

  // The IdP url is filled in after we know its port (used by the BFF
  // `/start` page to link to `/authorize`). Same for BFF callback url.
  let idpAuthorizeUrl = "";
  let idpTokenUrl = "";
  let bffCallbackUrl = "";
  let bffApiProtectedUrl = "";
  let upstreamWidgetsUrl = "";

  const bffServer = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/start")) {
      const target =
        `${idpAuthorizeUrl}?response_type=code` +
        `&client_id=bff` +
        `&state=${encodeURIComponent(state)}` +
        `&nonce=NC_nonce_abcdef123456` +
        `&redirect_uri=${encodeURIComponent(bffCallbackUrl)}`;
      const html =
        `<!doctype html><html><body><h1>BFF start</h1>` +
        `<a id="login" href="${target}">login</a></body></html>`;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Set-Cookie",
        `XSRF-TOKEN=${csrfToken}; Path=/; SameSite=Lax`,
      );
      res.end(html);
      return;
    }
    if (url.startsWith("/callback")) {
      // The inline script reads the XSRF cookie set by /start and
      // echoes it back as `X-XSRF-TOKEN` on the protected fetch —
      // exactly the double-submit pattern `detectCsrf` matches on.
      // It then issues a cross-origin GET to the upstream API so
      // the classifier sees an `upstream` event.
      // Pull `code` off our own URL so the inline script can POST it
      // back to the IdP `/token` endpoint — that gives the recorder a
      // captured `idp` event with path `/token` in addition to
      // `/authorize`, exercising the full OAuth code-exchange leg.
      const codeMatch = url.match(/[?&]code=([^&]+)/);
      const codeQ = codeMatch ? codeMatch[1] : "";
      const html =
        `<!doctype html><html><body><h1>BFF callback</h1>` +
        `<script>` +
        `(async () => {` +
        `  const m = document.cookie.match(/XSRF-TOKEN=([^;]+)/);` +
        `  const t = m ? m[1] : "";` +
        `  await fetch(${JSON.stringify(idpTokenUrl)}, {` +
        `    method: "POST",` +
        `    headers: { "Content-Type": "application/x-www-form-urlencoded" },` +
        `    body: "grant_type=authorization_code&code=" + ${JSON.stringify(codeQ)},` +
        `  });` +
        `  await fetch(${JSON.stringify(bffApiProtectedUrl)}, {` +
        `    headers: { "X-XSRF-TOKEN": t },` +
        `    credentials: "include",` +
        `  });` +
        `  await fetch(${JSON.stringify(upstreamWidgetsUrl)});` +
        `  document.title = "bff-callback-done";` +
        `})();` +
        `</script></body></html>`;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    if (url.startsWith("/api/protected")) {
      // Real BFF double-submit guard: refuse the request unless the
      // X-XSRF-TOKEN request header echoes the XSRF-TOKEN cookie. This
      // is what the JMX recorder's `detectCsrf` then pattern-matches
      // on, and what proves to the smoke test that the callback's
      // inline script actually wrote the header (a missing header
      // would 403 here and the captured event would have status 403,
      // making the failure loud rather than silent).
      const cookieHeader =
        (req.headers["cookie"] as string | undefined) ?? "";
      const cookieMatch = cookieHeader.match(/XSRF-TOKEN=([^;]+)/);
      const cookieVal = cookieMatch ? cookieMatch[1] : "";
      const headerVal =
        (req.headers["x-xsrf-token"] as string | undefined) ?? "";
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (!headerVal || headerVal !== cookieVal) {
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "csrf_mismatch" }));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, scope: "bff-protected" }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  const idpServer = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/authorize")) {
      // Always 302 back to the BFF callback with the canned literal
      // `state` + `code`. We don't validate the inbound `state` /
      // `redirect_uri` — this is a recording fixture, not a real IdP.
      const location =
        `${bffCallbackUrl}?code=${encodeURIComponent(code)}` +
        `&state=${encodeURIComponent(state)}`;
      res.statusCode = 302;
      res.setHeader("Location", location);
      res.end();
      return;
    }
    if (url.startsWith("/token")) {
      // Minimal authorization-code token exchange endpoint. The
      // callback page POSTs `grant_type=authorization_code&code=...`
      // here so the recorder captures an IdP `/token` event in
      // addition to `/authorize`. The body is irrelevant to the
      // assertions — what matters is that the URL classifies as `idp`
      // (path marker `/token`), which keeps the IdP grouping
      // controller populated with both legs of the OAuth dance.
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(
        JSON.stringify({
          access_token: "AT_access_token_xyz",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  const upstreamServer = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/v1/widgets")) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(JSON.stringify({ widgets: [{ id: 1, name: "widget-1" }] }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  const [bffPort, idpPort, upstreamPort] = await Promise.all([
    listenOnEphemeralPort(bffServer),
    listenOnEphemeralPort(idpServer),
    listenOnEphemeralPort(upstreamServer),
  ]);

  const bffUrl = `http://127.0.0.1:${bffPort}`;
  const idpUrl = `http://127.0.0.1:${idpPort}`;
  // Upstream uses the `localhost` hostname (same loopback bind, different
  // URL hostname string) so the BFF endpoint classifier's sticky
  // `idpHosts` set — keyed on `URL.hostname` — distinguishes it from
  // the IdP. In production BFF/IdP/Upstream are always distinct hosts;
  // co-locating them on `127.0.0.1` here would intentionally trip the
  // classifier's hostname-level sticky-set and miscategorize the
  // upstream call as `idp`.
  const upstreamUrl = `http://localhost:${upstreamPort}`;
  // Late-bind the inter-server URLs the request handlers close over.
  idpAuthorizeUrl = `${idpUrl}/authorize`;
  idpTokenUrl = `${idpUrl}/token`;
  bffCallbackUrl = `${bffUrl}/callback`;
  bffApiProtectedUrl = `${bffUrl}/api/protected`;
  upstreamWidgetsUrl = `${upstreamUrl}/v1/widgets`;

  return {
    urls: { bffUrl, idpUrl, upstreamUrl, csrfToken, state, code },
    async close() {
      await Promise.all([
        closeServer(bffServer),
        closeServer(idpServer),
        closeServer(upstreamServer),
      ]);
    },
  };
}

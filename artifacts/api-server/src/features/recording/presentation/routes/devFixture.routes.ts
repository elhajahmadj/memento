import { Router, type IRouter } from "express";
import { isDevEnvironment } from "@/features/auth/infrastructure/devEnvironment";

/**
 * Self-driving login form served by `/recording/dev-fixture-login`. The
 * inline `<script>` waits 250ms (so the recorder script's
 * `addInitScript` install has run for the loaded frame), then mutates
 * the two inputs and dispatches bubbling `change` events plus a real
 * button click. The recorder's capture-phase listeners pick those up
 * and emit `fill` / `fill` / `click` actions; the api-server's
 * `framenavigated` handler emits the leading `navigate` action.
 */
const DEV_FIXTURE_LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Demo App — Sign in</title>
  <style>
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f3f4f6; margin: 0; padding: 48px 16px; color: #111827; }
    .card { max-width: 360px; margin: 0 auto; background: #ffffff; padding: 28px 28px 24px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04); }
    h1 { font-size: 1.125rem; margin: 0 0 4px; }
    p.sub { color: #6b7280; font-size: 0.875rem; margin: 0 0 20px; }
    label { display: block; font-size: 0.8125rem; color: #374151; margin: 0 0 6px; }
    input { width: 100%; padding: 9px 11px; margin-bottom: 14px; border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box; font-size: 0.9375rem; }
    button { width: 100%; padding: 10px 12px; background: #2563eb; color: #ffffff; border: 0; border-radius: 6px; font-weight: 500; font-size: 0.9375rem; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Sign in to Demo</h1>
    <p class="sub">Use your account to continue.</p>
    <form id="login-form" onsubmit="return false;">
      <label for="username">Email</label>
      <input id="username" name="username" type="email" autocomplete="off">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="off">
      <button id="login-submit" data-testid="login-submit" type="button">Sign in</button>
    </form>
  </div>
  <script>
    (function () {
      function fireChange(el, value) {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      function run() {
        var u = document.getElementById('username');
        if (u) fireChange(u, 'demo.user@example.com');
        var p = document.getElementById('password');
        if (p) fireChange(p, 'CorrectHorseBatteryStaple');
        var btn = document.getElementById('login-submit');
        if (btn) btn.click();
      }
      setTimeout(run, 250);
    })();
  </script>
</body>
</html>
`;

export function devFixtureRoutes(): IRouter {
  const router = Router();

  /**
   * Dev-only static HTML "login" page used by the docs-screenshot harness
   * (`artifacts/test-builder/e2e-docs/capture.spec.ts`) as a recorder
   * `startUrl`. It self-fires `change` and `click` DOM events on a small
   * form so the recorder script captures a realistic 4-action recording
   * (navigate → fill username → fill password → click submit) without
   * needing the harness to drive the headless recorder Chromium.
   *
   * Returns 404 outside `local`/`development` so production deployments
   * never expose it. Unauthenticated by allowlist because the recorder
   * Chromium that fetches it has no session cookie.
   */
  router.get("/recording/dev-fixture-login", (_req, res) => {
    if (!isDevEnvironment()) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(DEV_FIXTURE_LOGIN_HTML);
  });

  return router;
}

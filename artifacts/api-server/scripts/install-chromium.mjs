#!/usr/bin/env node
/**
 * Ensure Playwright's Chromium browser is installed for the api-server.
 *
 * Why this exists:
 *   Three server features launch Chromium via Playwright at runtime:
 *     - Recorder       (src/features/recording/infrastructure/recordingService.ts)
 *     - In-app Validate (src/features/validation/infrastructure/replayService.ts)
 *     - Architecture browser preview
 *       (src/features/architectures/infrastructure/architectureService.ts)
 *
 *   Without the binary on disk, the very first `chromium.launch()` returns a
 *   400 to the user (e.g. clicking "Start Recording" on a fresh Replit).
 *
 * Behaviour:
 *   - Idempotent: Playwright's own installer is a no-op when the right
 *     browser revision is already cached.
 *   - Sandbox-tolerant: if the download is blocked (offline build, restricted
 *     CI, etc.) we log a warning and exit 0 so we don't break `pnpm install`.
 *     The recorder will surface a clear error at runtime instead.
 *   - Skippable: set `SKIP_PLAYWRIGHT_INSTALL=1` to bypass entirely (handy
 *     for offline / cached image builds).
 *
 * No `--with-deps`: the system libraries Chromium needs come from
 * `replit.nix` at the repo root; the Playwright apt-get path doesn't apply
 * on NixOS anyway.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';

if (process.env.SKIP_PLAYWRIGHT_INSTALL === '1') {
  console.log('[api-server] SKIP_PLAYWRIGHT_INSTALL=1 set, skipping Chromium install.');
  process.exit(0);
}

const require = createRequire(import.meta.url);

let playwrightCli;
try {
  // Resolve playwright via its package.json (always exported), then locate
  // the CLI entry from the package's `bin` field. The CLI is not exposed as
  // a subpath export, so `require.resolve('playwright/cli.js')` would fail.
  const pkgJsonPath = require.resolve('playwright/package.json');
  const pkgDir = dirname(pkgJsonPath);
  const pkg = require(pkgJsonPath);
  const binEntry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.playwright;
  if (!binEntry) {
    throw new Error('playwright package has no `bin.playwright` entry');
  }
  playwrightCli = resolvePath(pkgDir, binEntry);
  if (!existsSync(playwrightCli)) {
    throw new Error(`playwright CLI not found at ${playwrightCli}`);
  }
} catch (err) {
  console.warn(
    '[api-server] Could not locate the `playwright` package; skipping Chromium install. ' +
      'Install dependencies first, then re-run `pnpm --filter @workspace/api-server exec playwright install chromium`.',
  );
  console.warn(`  reason: ${err && err.message ? err.message : err}`);
  process.exit(0);
}

console.log('[api-server] Ensuring Playwright Chromium is installed...');

const child = spawn(process.execPath, [playwrightCli, 'install', 'chromium'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (err) => {
  console.warn(
    '[api-server] Failed to spawn Playwright installer; Chromium may be missing. ' +
      'Run `pnpm --filter @workspace/api-server exec playwright install chromium` manually before using the recorder.',
  );
  console.warn(`  reason: ${err && err.message ? err.message : err}`);
  process.exit(0);
});

child.on('exit', (code, signal) => {
  if (code === 0) {
    console.log('[api-server] Playwright Chromium is ready.');
    process.exit(0);
  }
  console.warn(
    `[api-server] Playwright Chromium install exited with ${signal ?? `code ${code}`}. ` +
      'This is non-fatal for the install step, but the recorder, in-app Validate, ' +
      'and architecture preview will fail until Chromium is present. ' +
      'Re-run `pnpm --filter @workspace/api-server exec playwright install chromium` ' +
      'once the environment can reach the Playwright CDN.',
  );
  process.exit(0);
});

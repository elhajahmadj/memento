import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5273);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Specs that exercise the live API server (admin/SSO/PAT flows) read
// E2E_API_BASE_URL and silently `test.skip()` when it's missing. That
// makes a fresh `pnpm run test:e2e:*` shell look like a pass when in
// fact nothing executed. Default it to the shared Replit proxy so the
// specs run out of the box; CI / local runs can still override.
process.env.E2E_API_BASE_URL =
  process.env.E2E_API_BASE_URL ?? "http://localhost:80";

// The Replit environment ships a Nix-built Chromium binary. Playwright's
// own browser cache is not populated here, so point launchOptions at the
// system binary instead. Override with PLAYWRIGHT_CHROMIUM_BIN when
// running locally with a different chromium path.
const CHROMIUM_BIN =
  process.env.PLAYWRIGHT_CHROMIUM_BIN ??
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    launchOptions: {
      executablePath: CHROMIUM_BIN,
      args: ["--no-sandbox"],
    },
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm exec vite --config vite.config.ts --host 127.0.0.1",
    url: `${BASE_URL}/e2e-fixture.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      BASE_PATH: "/",
      NODE_ENV: "test",
    },
  },
});

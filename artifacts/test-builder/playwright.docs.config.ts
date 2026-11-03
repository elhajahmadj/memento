import { defineConfig, devices } from "@playwright/test";

/**
 * Documentation-screenshot harness config — kept separate from the
 * functional `playwright.config.ts` because it talks to the real
 * running app stack (test-builder + api-server behind the shared
 * Replit proxy) instead of the in-process Vite fixture used by
 * `e2e/right-click-pick-element.spec.ts`.
 *
 * Defaults assume the workflows are already running:
 *   - test-builder web preview reachable at `BASE_URL` (default
 *     `http://localhost:80`)
 *   - api-server reachable at `${BASE_URL}/api`
 *
 * Use the wrapper `scripts/refresh-doc-screenshots.sh` to drive this.
 */
const BASE_URL = process.env.DOC_BASE_URL ?? "http://localhost:80";

const CHROMIUM_BIN =
  process.env.PLAYWRIGHT_CHROMIUM_BIN ??
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

export default defineConfig({
  testDir: "./e2e-docs",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // Heavy waits per role (sign in + scaffold + every page).
  timeout: 240_000,
  use: {
    baseURL: BASE_URL,
    headless: process.env.PLAYWRIGHT_HEADED === "1" ? false : true,
    launchOptions: {
      executablePath: CHROMIUM_BIN,
      args: ["--no-sandbox"],
    },
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});

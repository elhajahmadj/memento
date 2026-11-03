/**
 * Node.js (Playwright Test + TypeScript) default architecture file
 * templates. `{{Package}}`, `{{Solution}}`, and `{{Namespace}}` are
 * substituted by the project scaffolder.
 */

export const NODEJS_PACKAGE_JSON_CONTENT = `{
  "name": "{{Package}}",
  "version": "0.1.0",
  "private": true,
  "description": "Playwright + @playwright/test suite for {{Solution}}",
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "install:browsers": "playwright install"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "@types/node": "^20.0.0",
    "dotenv": "^16.4.5",
    "typescript": "^5.4.0"
  }
}
`;

export const NODEJS_PLAYWRIGHT_CONFIG_CONTENT = `import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const TRACE_MODE = (process.env.PLAYWRIGHT_TRACE ?? "on-first-retry") as
  | "off"
  | "on"
  | "retain-on-failure"
  | "on-first-retry"
  | "on-all-retries";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: true,
  passWithNoTests: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: TRACE_MODE,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
`;

export const NODEJS_TSCONFIG_CONTENT = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@pages/*": ["pages/*"],
      "@shared/*": ["shared/*"]
    }
  },
  "include": ["tests/**/*.ts", "pages/**/*.ts", "shared/**/*.ts", "playwright.config.ts"]
}
`;

export const NODEJS_SMOKE_SPEC_CONTENT = `import { test, expect } from "@playwright/test";

// Sample smoke test shipped with the scaffold. Visits \`about:blank\`
// so a freshly downloaded project produces a green Playwright run on
// the very first F5 in VS Code, before any suites have been recorded.
// Safe to delete (or replace) once you record real tests.
test("smoke", async ({ page }) => {
  await page.goto("about:blank");
  await expect(page).toHaveURL("about:blank");
});
`;

export const NODEJS_GITIGNORE_CONTENT = `node_modules/
dist/
test-results/
playwright-report/
playwright-traces/
.env
.env.local
`;

export const NODEJS_ENV_EXAMPLE_CONTENT = `# Base URL the recorded suites navigate to. Override per environment.
{{Solution}}_BASE_URL=https://example.com

# Per-named-URL overrides used by recorded suites. The recorder generates
# env-var names of the form <SOLUTION>_URL_<NAME>, e.g.:
#   {{Solution}}_URL_HOMEPAGE=https://example.com

# Browser selection (chromium / firefox / webkit / chromium channels like
# msedge / chrome).
{{Solution}}_BROWSER=chromium
{{Solution}}_USE_CHROMIUM=true
{{Solution}}_HEADLESS=false

# Playwright trace mode. Accepts: off / on / retain-on-failure /
# on-first-retry / on-all-retries. Read by playwright.config.ts at startup.
PLAYWRIGHT_TRACE=on-first-retry

# Active environment label (Local / Dev / QA / Prod). When unset (or
# Local / Development) the trace upload hook is skipped.
{{Solution}}_ENVIRONMENT=Local
`;

export const NODEJS_README_CONTENT = `# {{Solution}}

Playwright + \`@playwright/test\` (TypeScript) suite scaffolded by Test Builder.

## Setup

\`\`\`
npm install
npx playwright install chromium
\`\`\`

## Run tests

\`\`\`
npx playwright test
\`\`\`

## Tracing

Tracing is controlled by the \`PLAYWRIGHT_TRACE\` env var (read in
\`playwright.config.ts\`). Set it to \`on\` for an "always trace" run, or
to \`retain-on-failure\` to keep traces only for failed tests.
Failed tests automatically attach a screenshot under \`test-results/\`.
`;

export const NODEJS_CONSTANTS_CONTENT = `/**
 * Recorded literal values extracted from \`fill\` actions.
 *
 * The recorder appends entries here when the user records a \`fill\` action
 * so generated test bodies read \`Constants.userName\` instead of an
 * inline string literal. Mirrors
 * \`{{Namespace}}.Shared.Configuration.Constants\` in the C# default arch.
 *
 * The \`START_TRACER\` key is preserved as a compile-time identifier
 * paired with the Playwright Test \`@start-tracer\` tag (see
 * \`shared/fixtures.ts\`) — tests that include that tag in their title
 * unconditionally start tracing regardless of the global config.
 */
export const Constants = {
  START_TRACER: "@start-tracer",
} as const;
`;

export const NODEJS_TEST_CONFIG_CONTENT = `/**
 * Strongly-typed mirror of the .env / appsettings configuration.
 *
 * Mirrors the role of
 * \`{{Namespace}}.Shared.Configuration.TestConfig\` in the C# default
 * architecture: a single, discoverable surface that fixtures and page
 * objects can read configuration from without re-parsing
 * \`process.env\` on every test.
 *
 * \`TestConfig.load()\` hydrates the singleton from the environment once
 * per process; subsequent reads come from the cached object.
 */

export interface TestConfigShape {
  /** Browser channel used when \`useChromium\` is false. */
  defaultBrowser: string;
  /** Run the browser without a visible window. */
  headless: boolean;
  /** When true, launch vanilla Chromium; otherwise use \`defaultBrowser\`. */
  useChromium: boolean;
  /** Force-enable Playwright tracing for every test in the run. */
  startTracer: boolean;
  /** Default Playwright operation timeout in milliseconds. */
  playwrightTimeout: number;
  /** Active environment label (Local / Dev / QA / Prod / ...). */
  environment: string;
  /** Named application URLs recorded into \`.env\` as <SOLUTION>_URL_<NAME>. */
  urls: Record<string, string>;
  /** When set, only the matching test will run; others are skipped. */
  testName: string;
}

const DEFAULTS: TestConfigShape = {
  defaultBrowser: "msedge",
  headless: false,
  useChromium: true,
  startTracer: false,
  playwrightTimeout: 30_000,
  environment: "Local",
  urls: {},
  testName: "",
};

function readBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return /^(true|1|yes)$/i.test(raw.trim());
}

function readInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function collectUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!v) continue;
    const idx = k.indexOf("_URL_");
    if (idx > 0) out[k.slice(idx + "_URL_".length)] = v;
  }
  return out;
}

class TestConfigImpl implements TestConfigShape {
  defaultBrowser = DEFAULTS.defaultBrowser;
  headless = DEFAULTS.headless;
  useChromium = DEFAULTS.useChromium;
  startTracer = DEFAULTS.startTracer;
  playwrightTimeout = DEFAULTS.playwrightTimeout;
  environment = DEFAULTS.environment;
  urls = { ...DEFAULTS.urls };
  testName = DEFAULTS.testName;

  // Named URLs (regenerated from .env on every recording).
  // The block below is rewritten by the recorder every time it upserts a
  // named URL or finalizes a recording, so each recorded suite can write
  // \`TestConfig.LOGIN\` instead of \`process.env["ACMEJS_URL_LOGIN"]\`.
  // <auto-generated-urls>
  // </auto-generated-urls>

  load(): this {
    this.defaultBrowser =
      process.env.DEFAULT_BROWSER ?? DEFAULTS.defaultBrowser;
    this.headless = readBool("HEADLESS", DEFAULTS.headless);
    this.useChromium = readBool("USE_CHROMIUM", DEFAULTS.useChromium);
    this.startTracer = readBool("START_TRACER", DEFAULTS.startTracer);
    this.playwrightTimeout = readInt(
      "PLAYWRIGHT_TIMEOUT",
      DEFAULTS.playwrightTimeout,
    );
    this.environment = process.env.ENVIRONMENT ?? DEFAULTS.environment;
    this.urls = collectUrls();
    this.testName = process.env.TEST_NAME ?? DEFAULTS.testName;
    return this;
  }
}

export const TestConfig = new TestConfigImpl().load();
`;

export const NODEJS_BROWSER_MANAGER_CONTENT = `/**
 * Owns the Playwright tracing + screenshot helpers.
 *
 * Mirrors the role of
 * \`{{Namespace}}.Infrastructure.Services.BrowserManager\` in the C#
 * default architecture. The launching of browsers / contexts / pages
 * is delegated to \`@playwright/test\` (which exposes the
 * \`browser\` / \`context\` / \`page\` fixtures already), so this class
 * focuses on the cross-cutting helpers C# users get from
 * \`BrowserManager\`:
 *
 *   - \`takeScreenshot\` — writes a PNG into \`test-results/\` on failure.
 *   - \`startTracing\` / \`stopTracing\` — wraps Playwright's
 *     \`context.tracing.start()\` / \`stop()\` and (when configured) hands
 *     the resulting zip to
 *     \`PlaywrightTraceExtensions.uploadPlaywrightTrace\`.
 *
 * \`@playwright/test\` already runs \`screenshot: "only-on-failure"\` from
 * the scaffold's \`playwright.config.ts\`; \`takeScreenshot\` is exposed
 * for callers that want to attach an explicit screenshot mid-test.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";

import { TestConfig } from "./testConfig";
import { TestOutputLogger } from "./testOutputLogger";
import { PlaywrightTraceExtensions } from "./playwrightTraceExtensions";

// Lexicographically sortable, locale-independent, Windows-safe (no
// colons or spaces). Matches the C# BrowserManager timestamp format so
// attachments interleave naturally when sorted by name.
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80) || "test";
}

export class BrowserManager {
  tracingStarted = false;

  // -- Screenshots -----------------------------------------------------

  async takeScreenshot(
    page: Page,
    logger: TestOutputLogger,
    testName: string,
  ): Promise<string | null> {
    try {
      const outDir = path.resolve("test-results");
      await fs.mkdir(outDir, { recursive: true });
      const target = path.join(
        outDir,
        \`\${safeName(testName)}_\${timestamp()}.png\`,
      );
      await page.screenshot({ path: target, fullPage: true });
      logger.logScreenshotData(target);
      return target;
    } catch (ex) {
      logger.logWarning(\`Could not capture screenshot: \${(ex as Error).message}\`);
      return null;
    }
  }

  // -- Tracing ---------------------------------------------------------

  async startTracing(context: BrowserContext, testName = ""): Promise<void> {
    if (this.tracingStarted) return;
    await context.tracing.start({
      title: testName,
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    this.tracingStarted = true;
  }

  async stopTracing(
    context: BrowserContext,
    page: Page | null,
    upload: boolean,
    logger: TestOutputLogger,
    testName = "trace",
  ): Promise<string | null> {
    if (!this.tracingStarted) return null;
    if (page && page.url() === "about:blank") {
      this.tracingStarted = false;
      return null;
    }
    try {
      const outDir = path.resolve("playwright-traces");
      await fs.mkdir(outDir, { recursive: true });
      const target = path.join(
        outDir,
        \`\${safeName(testName)}_\${timestamp()}.zip\`,
      );
      await context.tracing.stop({ path: target });
      logger.logTracerData(target);
      if (upload) {
        try {
          const url =
            await PlaywrightTraceExtensions.uploadPlaywrightTrace(target);
          if (url) console.log(\`View Playwright trace: \${url}\`);
        } catch (ex) {
          console.log(\`Trace upload failed: \${(ex as Error).message}\`);
        }
      }
      return target;
    } catch (ex) {
      logger.logWarning(\`Tracing could not be stopped: \${(ex as Error).message}\`);
      return null;
    } finally {
      this.tracingStarted = false;
    }
  }

  // -- Suite-wide page defaults ---------------------------------------

  configurePage(page: Page): Page {
    page.setDefaultTimeout(TestConfig.playwrightTimeout);
    return page;
  }
}
`;

export const NODEJS_TEST_CONTEXT_HELPER_CONTENT = `/**
 * Thin wrapper around the active Playwright \`TestInfo\`.
 *
 * Mirrors the role of \`{{Namespace}}.Shared.Helpers.TestContextHelper\`
 * in the C# default architecture: exposes the most commonly used fields
 * for logging and conditional teardown logic so callers don't have to
 * poke at \`TestInfo\` internals directly.
 */
import { test, type TestInfo } from "@playwright/test";

export class TestContextHelper {
  constructor(private readonly info: TestInfo) {}

  get testName(): string {
    return this.info.title;
  }

  get fullName(): string {
    return this.info.titlePath.join(" > ");
  }

  get className(): string {
    return this.info.titlePath.slice(0, -1).join(" > ");
  }

  get methodName(): string {
    return this.info.title;
  }

  get message(): string {
    return this.info.error?.message ?? "";
  }

  get stackTrace(): string {
    return this.info.error?.stack ?? "";
  }

  get outcome(): string {
    return this.info.status ?? "";
  }

  hasTestFailed(): boolean {
    return this.info.status === "failed" || this.info.status === "timedOut";
  }

  hasTestPassed(): boolean {
    return this.info.status === "passed";
  }

  wasTestSkipped(): boolean {
    return this.info.status === "skipped";
  }

  /**
   * Skip the running test when a name filter is set and doesn't match.
   * Mirrors the C# \`RunTestByName\` helper used by \`TestConfig.testName\`.
   */
  runTestByName(targetTestName: string): void {
    if (!targetTestName) return;
    if (targetTestName.toLowerCase() !== this.methodName.toLowerCase()) {
      test.skip(
        true,
        \`Skipped: filter '\${targetTestName}' does not match \${this.methodName}.\`,
      );
    }
  }
}
`;

export const NODEJS_TEST_OUTPUT_LOGGER_CONTENT = `/**
 * Diagnostic output helper.
 *
 * Mirrors the role of \`{{Namespace}}.Shared.Helpers.TestOutputLogger\`
 * in the C# default architecture. Replace this implementation to
 * forward to a structured logger or test reporter without touching the
 * fixture call sites.
 *
 * \`console.log\` is captured by the Playwright Test runner and
 * surfaced in the per-test attachments / HTML report.
 */
import type { TestContextHelper } from "./testContextHelper";

export class TestOutputLogger {
  logTestFailedData(context: TestContextHelper): void {
    console.log("==========================================");
    console.log(\`TEST FAILED: \${context.fullName}\`);
    console.log(\`Message    : \${context.message}\`);
    console.log(\`StackTrace : \${context.stackTrace}\`);
    console.log("==========================================");
  }

  logScreenshotData(screenshotPath: string): void {
    console.log(\`Screenshot saved to: \${screenshotPath}\`);
  }

  logTracerData(tracerPath: string): void {
    console.log(\`Playwright trace saved to: \${tracerPath}\`);
    console.log(\`View locally with: npx playwright show-trace \${tracerPath}\`);
  }

  logInfo(message: string): void {
    console.log(\`[INFO] \${message}\`);
  }

  logWarning(message: string): void {
    console.log(\`[WARN] \${message}\`);
  }

  logError(message: string, ex?: unknown): void {
    console.log(\`[ERROR] \${message}\`);
    if (ex !== undefined) console.log(String(ex));
  }
}
`;

export const NODEJS_TEST_TRACKER_CONTENT = `/**
 * Process-wide counters for test outcomes.
 *
 * Mirrors the role of \`{{Namespace}}.Shared.Helpers.TestTracker\` in
 * the C# default architecture. \`shared/fixtures.ts\` calls these from
 * its \`afterEach\` hook, where the Playwright \`TestInfo.status\`
 * reliably reflects the individual test's outcome. The resulting
 * totals are useful when generating a run summary in
 * \`globalTeardown\`.
 */
export class TestTracker {
  private static _passing = 0;
  private static _skipped = 0;
  private static _failed = 0;

  static countPassingTests(peek = false): number {
    if (!peek) TestTracker._passing += 1;
    return TestTracker._passing;
  }

  static countSkippedTests(peek = false): number {
    if (!peek) TestTracker._skipped += 1;
    return TestTracker._skipped;
  }

  static countFailingTests(peek = false): number {
    if (!peek) TestTracker._failed += 1;
    return TestTracker._failed;
  }

  static reset(): void {
    TestTracker._passing = 0;
    TestTracker._skipped = 0;
    TestTracker._failed = 0;
  }
}
`;

export const NODEJS_PLAYWRIGHT_TRACE_EXTENSIONS_CONTENT = `/**
 * Hook for shipping a local Playwright trace zip to a remote viewer.
 *
 * Replace \`PlaywrightTraceExtensions.uploadPlaywrightTrace\` with your
 * own upload logic (S3, Azure Blob, GCS, ...) and return the public
 * URL the \`playwright show-trace\` viewer should be opened with.
 *
 * Mirrors \`{{Namespace}}.Shared.Extensions.PlaywrightTraceExtensions\`
 * in the C# default architecture: a deliberately tiny seam for the
 * infrastructure layer to call out to without dragging the SDK into
 * the default scaffold.
 */
export class PlaywrightTraceExtensions {
  static async uploadPlaywrightTrace(
    tracerPath: string,
  ): Promise<string | null> {
    // No-op default. Replace with real upload logic when ready.
    void tracerPath;
    return null;
  }
}
`;

export const NODEJS_FIXTURES_CONTENT = `/**
 * Test fixtures shared by every recorded suite.
 *
 * Mirrors the role of
 * \`{{Namespace}}.Infrastructure.Fixtures.TestFixtureBase\` in the C#
 * default architecture, but using Playwright Test's \`test.extend\`
 * pattern instead of NUnit inheritance:
 *
 *   - \`browserManager\` exposes the screenshot / tracing helpers.
 *   - \`testOutputLogger\` exposes the diagnostic logger.
 *   - An \`auto\` fixture wraps each test with start-/stop-tracing
 *     when one of:
 *       - \`TestConfig.startTracer\` is true (env-driven, hydrated from
 *         \`.env\` / process env at startup),
 *       - the test title contains the \`@start-tracer\` tag
 *         (\`Constants.START_TRACER\`).
 *   - An \`afterEach\` hook tallies pass/skip/fail outcomes on
 *     \`TestTracker\` so \`globalTeardown\` can print a run summary.
 *
 * Recorded \`*.spec.ts\` files import \`{ test, expect }\` from this
 * module (\`../shared/fixtures\`) instead of \`@playwright/test\`
 * directly, so every recorded suite picks up the wrapped fixtures
 * automatically. \`expect\` is re-exported below so the swap is
 * transparent to existing Playwright Test users.
 */
import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { BrowserManager } from "./browserManager";
import { Constants } from "./constants";
import { TestConfig } from "./testConfig";
import { TestContextHelper } from "./testContextHelper";
import { TestOutputLogger } from "./testOutputLogger";
import { TestTracker } from "./testTracker";
import { PlaywrightTraceExtensions } from "./playwrightTraceExtensions";

interface AppFixtures {
  browserManager: BrowserManager;
  testOutputLogger: TestOutputLogger;
  /** Auto-fixture: wraps each test with start/stop tracing on demand. */
  _tracingAuto: void;
  /** Auto-fixture: tallies pass/skip/fail counts after each test. */
  _trackerAuto: void;
}

function shouldStartTracer(testTitle: string): boolean {
  if (TestConfig.startTracer) return true;
  if (testTitle.includes(Constants.START_TRACER)) return true;
  const env = (process.env.START_TRACER ?? "").trim().toLowerCase();
  return env === "1" || env === "true" || env === "yes";
}

function isLocalEnv(): boolean {
  const env = (TestConfig.environment || "Local").toLowerCase();
  return env === "local" || env === "development";
}

export const test = base.extend<AppFixtures>({
  browserManager: async ({}, use) => {
    await use(new BrowserManager());
  },
  testOutputLogger: async ({}, use) => {
    await use(new TestOutputLogger());
  },
  _tracingAuto: [
    async (
      {
        context,
        page,
        browserManager,
        testOutputLogger,
      }: {
        context: BrowserContext;
        page: Page;
        browserManager: BrowserManager;
        testOutputLogger: TestOutputLogger;
      },
      use: (value: void) => Promise<void>,
      testInfo,
    ) => {
      const opted = shouldStartTracer(testInfo.title);
      if (opted) await browserManager.startTracing(context, testInfo.title);
      await use();
      if (opted) {
        await browserManager.stopTracing(
          context,
          page,
          !isLocalEnv(),
          testOutputLogger,
          testInfo.title,
        );
      }
    },
    { auto: true },
  ],
  _trackerAuto: [
    async ({}, use, testInfo) => {
      await use();
      const helper = new TestContextHelper(testInfo);
      const logger = new TestOutputLogger();
      if (helper.hasTestFailed()) {
        logger.logTestFailedData(helper);
        TestTracker.countFailingTests();
      } else if (helper.hasTestPassed()) {
        TestTracker.countPassingTests();
      } else if (helper.wasTestSkipped()) {
        TestTracker.countSkippedTests();
      }
    },
    { auto: true },
  ],
});

export { expect, BrowserManager, TestConfig, TestContextHelper, TestOutputLogger, TestTracker, PlaywrightTraceExtensions };
`;

export const NODEJS_PAGES_README_CONTENT = `# Page objects

Generated per-suite \`<Suite>Selectors.ts\` (under \`selectors/\`) and
\`<Suite>Actions.ts\` (under \`actions/\`) files land here when the
recorder finalizes a suite. Each Actions class wraps a Playwright
\`Page\` and exposes one method per recorded interaction.
`;

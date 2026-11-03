import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  createProject,
  loadProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import { NODEJS_DEFAULT_ARCHITECTURE_ID } from "@/features/architectures/infrastructure/architectureService";

let tmp: string;
let originalWorkspace: string;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-nodejsscaff-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
  setCurrentProject(null);
});

afterEach(async () => {
  recorderConfig.workspaceDir = originalWorkspace;
  setCurrentProject(null);
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("createProject with nodejs-default architecture", () => {
  it("emits a flat node tree with package.json as the project marker", async () => {
    const project = await createProject({
      solutionName: "AcmeJs",
      namespace: "acme.qa",
      language: "nodejs",
    });

    expect(project.language).toBe("nodejs");
    expect(project.solutionName).toBe("AcmeJs");
    // Solution `AcmeJs` → kebab-case package `acme-js`. npm package names
    // serve double duty as the "test project name" for Node.js.
    expect(project.testProjectName).toBe("acme-js");
    expect(project.rootPath).toBe(path.join(tmp, "AcmeJs"));
    // Node.js projects re-use `slnPath` to point at the root package.json
    // so the rest of the API surface (which keys projects by slnPath)
    // keeps working unchanged.
    expect(project.slnPath).toBe(path.join(tmp, "AcmeJs", "package.json"));

    const root = project.rootPath;
    expect(await exists(path.join(root, "package.json"))).toBe(true);
    expect(await exists(path.join(root, "playwright.config.ts"))).toBe(true);
    expect(await exists(path.join(root, "tsconfig.json"))).toBe(true);
    expect(await exists(path.join(root, "tests"))).toBe(true);
    expect(await exists(path.join(root, "pages", "selectors"))).toBe(true);
    expect(await exists(path.join(root, "pages", "actions"))).toBe(true);
    expect(await exists(path.join(root, "shared"))).toBe(true);

    // package.json should declare @playwright/test as a dev dependency and
    // use the kebab-case package name. `dotenv` is required because
    // playwright.config.ts side-effect-imports it to load the recorder-
    // written `<root>/.env` so generated `process.env[...]` reads resolve.
    const pkg = JSON.parse(
      await fs.readFile(path.join(root, "package.json"), "utf8"),
    );
    expect(pkg.name).toBe("acme-js");
    expect(pkg.devDependencies?.["@playwright/test"]).toBeTruthy();
    expect(pkg.devDependencies?.["dotenv"]).toBeTruthy();

    // playwright.config.ts must side-effect-import dotenv/config so the
    // recorder-written `.env` keys are visible to `process.env[...]`.
    // The screenshot + env-driven trace mode are part of the C# parity
    // pass (Task #6) so we lock those in too.
    const playwrightConfig = await fs.readFile(
      path.join(root, "playwright.config.ts"),
      "utf8",
    );
    expect(playwrightConfig).toContain('import "dotenv/config";');
    expect(playwrightConfig).toContain('screenshot: "only-on-failure"');
    expect(playwrightConfig).toContain("PLAYWRIGHT_TRACE");

    // Task #34: a sample `smoke.spec.ts` ships in `tests/` so a freshly
    // downloaded scaffold has something for `npx playwright test` (and
    // the F5 launch profiles) to actually run. The sample replaces the
    // older `.gitkeep` placeholder — assert both the file is present
    // and the placeholder is gone so a regression to "empty tests/"
    // is caught.
    const smokeSpecPath = path.join(root, "tests", "smoke.spec.ts");
    expect(await exists(smokeSpecPath)).toBe(true);
    expect(await exists(path.join(root, "tests", ".gitkeep"))).toBe(false);
    const smokeSpec = await fs.readFile(smokeSpecPath, "utf8");
    // Visits about:blank so the sample never makes a network call —
    // F5 on a clean download produces a green run without any setup
    // beyond `npm install` + `playwright install`.
    expect(smokeSpec).toContain('from "@playwright/test"');
    expect(smokeSpec).toContain('test("smoke"');
    expect(smokeSpec).toContain('"about:blank"');

    // Feature parity with the C# default architecture (Task #6): the
    // shared TS helpers must be on disk, not just `constants.ts`.
    expect(await exists(path.join(root, "shared", "constants.ts"))).toBe(
      true,
    );
    expect(await exists(path.join(root, "shared", "testConfig.ts"))).toBe(
      true,
    );
    expect(
      await exists(path.join(root, "shared", "browserManager.ts")),
    ).toBe(true);
    expect(
      await exists(path.join(root, "shared", "testContextHelper.ts")),
    ).toBe(true);
    expect(
      await exists(path.join(root, "shared", "testOutputLogger.ts")),
    ).toBe(true);
    expect(await exists(path.join(root, "shared", "testTracker.ts"))).toBe(
      true,
    );
    expect(
      await exists(
        path.join(root, "shared", "playwrightTraceExtensions.ts"),
      ),
    ).toBe(true);
    expect(await exists(path.join(root, "shared", "fixtures.ts"))).toBe(
      true,
    );

    // BrowserManager is a real class with start/stop tracing helpers
    // and a screenshot helper, not just a thin wrapper. We assert on
    // the public method names so a regression to "BrowserManager went
    // back to a stub" is caught.
    const browserManager = await fs.readFile(
      path.join(root, "shared", "browserManager.ts"),
      "utf8",
    );
    expect(browserManager).toContain("export class BrowserManager");
    expect(browserManager).toContain("startTracing(");
    expect(browserManager).toContain("stopTracing(");
    expect(browserManager).toContain("takeScreenshot(");

    // fixtures.ts wraps `test` from @playwright/test with the
    // tracing/tracker auto-fixtures so suites that opt in get the
    // C#-equivalent cross-cutting behavior.
    const fixtures = await fs.readFile(
      path.join(root, "shared", "fixtures.ts"),
      "utf8",
    );
    expect(fixtures).toContain("export const test = base.extend");
    expect(fixtures).toContain("BrowserManager");
    expect(fixtures).toContain("TestTracker");

    // Marker stores language so a re-load picks the right code path.
    const marker = JSON.parse(
      await fs.readFile(path.join(root, ".testbuilder.json"), "utf8"),
    );
    expect(marker.language).toBe("nodejs");
    expect(marker.architectureId).toBe(NODEJS_DEFAULT_ARCHITECTURE_ID);

    // Task #32: a freshly downloaded Node.js scaffold opens in VS Code
    // with the Playwright runner pre-wired. Assert the three files
    // exist with non-empty, JSON-parseable content and that launch.json
    // references `npx playwright test`.
    const settingsPath = path.join(root, ".vscode", "settings.json");
    const launchPath = path.join(root, ".vscode", "launch.json");
    const extensionsPath = path.join(root, ".vscode", "extensions.json");
    expect(await exists(settingsPath)).toBe(true);
    expect(await exists(launchPath)).toBe(true);
    expect(await exists(extensionsPath)).toBe(true);

    const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    expect(settings["typescript.tsdk"]).toBe("node_modules/typescript/lib");

    const launch = JSON.parse(await fs.readFile(launchPath, "utf8"));
    expect(Array.isArray(launch.configurations)).toBe(true);
    const launchNames = launch.configurations.map(
      (c: { name: string }) => c.name,
    );
    expect(launchNames).toContain("Playwright: run current spec");
    expect(launchNames).toContain("Playwright: run all tests");
    for (const cfg of launch.configurations) {
      // Both configs must invoke `npx playwright test` so the
      // project's playwright.config.ts (dotenv + tracing) loads.
      expect(cfg.runtimeExecutable).toBe("npx");
      expect(Array.isArray(cfg.runtimeArgs)).toBe(true);
      expect(cfg.runtimeArgs[0]).toBe("playwright");
      expect(cfg.runtimeArgs[1]).toBe("test");
    }

    const extensions = JSON.parse(await fs.readFile(extensionsPath, "utf8"));
    expect(extensions.recommendations).toContain("ms-playwright.playwright");
  });

  it("rehydrates language: 'nodejs' when re-loaded from disk", async () => {
    const created = await createProject({
      solutionName: "AcmeJs",
      namespace: "acme.qa",
      language: "nodejs",
    });
    setCurrentProject(null);

    const reloaded = await loadProject(created.slnPath);
    expect(reloaded.language).toBe("nodejs");
    expect(reloaded.solutionName).toBe("AcmeJs");
    expect(reloaded.rootPath).toBe(created.rootPath);
  });
});

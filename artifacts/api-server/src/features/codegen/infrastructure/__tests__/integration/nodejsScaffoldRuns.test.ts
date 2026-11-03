import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { recorderConfig } from "@/features/projects/infrastructure/config";
import { createProject, setCurrentProject } from "@/features/projects/infrastructure/projectService";

/**
 * Smoke-runs the Node.js scaffold end to end:
 *
 *   1. Scaffolds a Node.js project via `createProject`.
 *   2. Installs deps with `npm install` (this also pulls in
 *      `@playwright/test`, which is what we type-check `shared/fixtures.ts`
 *      against in the next step).
 *   3. Type-checks the whole scaffold via `tsc --noEmit -p tsconfig.json`.
 *      This is the assertion that `shared/fixtures.ts` and the rest of
 *      `shared/*.ts` actually compile against the user's installed
 *      `@playwright/test` types — a lighter-weight sibling to running
 *      Playwright itself but catches the kind of regressions the task
 *      description calls out (a typo in `test.extend`, a missing
 *      `BrowserContext` import, etc.).
 *   4. Runs `npx playwright test` against a passing spec that imports
 *      from `shared/fixtures` (asserts exit 0) — this is the proof that
 *      the wrapped `test` fixture actually starts up.
 *   5. Runs `npx playwright test` against a forced-failing spec and
 *      asserts a screenshot file landed under `test-results/`, which is
 *      the evidence that `screenshot: "only-on-failure"` in the
 *      generated `playwright.config.ts` survived the round trip.
 *
 * Gated behind `RUN_SCAFFOLD_INTEGRATION=1` because it requires Playwright
 * browser binaries (~120 MB download on a cold cache) and `npm` on PATH.
 */
const RUN = process.env.RUN_SCAFFOLD_INTEGRATION === "1";
const FIVE_MINUTES = 5 * 60 * 1000;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const name = String(e.name);
    const full = path.join(dir, name);
    if (e.isDirectory()) {
      out.push(...(await listFilesRecursive(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe.skipIf(!RUN)("nodejs scaffold runs end-to-end", () => {
  let tmp: string;
  let originalWorkspace: string;
  let projectRoot: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-nodejsrun-"));
    originalWorkspace = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;
    setCurrentProject(null);

    const project = await createProject({
      solutionName: "AcmeJs",
      namespace: "acme.qa",
      language: "nodejs",
    });
    projectRoot = project.rootPath;

    // `--no-audit --no-fund` keeps the install quiet; `--prefer-offline`
    // re-uses the host npm cache for repeat runs.
    const npmInstall = await run(
      "npm",
      ["install", "--no-audit", "--no-fund", "--prefer-offline"],
      { cwd: projectRoot },
    );
    if (npmInstall.code !== 0) {
      throw new Error(
        `npm install failed (${npmInstall.code}):\nstdout:\n${npmInstall.stdout}\nstderr:\n${npmInstall.stderr}`,
      );
    }

    // Idempotent: a no-op when chromium is already on the local cache.
    const browserInstall = await run(
      "npx",
      ["playwright", "install", "chromium"],
      { cwd: projectRoot },
    );
    if (browserInstall.code !== 0) {
      throw new Error(
        `playwright install chromium failed (${browserInstall.code}):\nstdout:\n${browserInstall.stdout}\nstderr:\n${browserInstall.stderr}`,
      );
    }
  }, FIVE_MINUTES);

  afterAll(async () => {
    recorderConfig.workspaceDir = originalWorkspace;
    setCurrentProject(null);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("ships a working .vscode/ folder pointing at the playwright runner", async () => {
    // Task #32: smoke-test the VS Code config that ships with the
    // Node.js scaffold. This runs alongside the heavier scaffold tests
    // because they share the same `beforeAll` scaffolded project.
    const vsDir = path.join(projectRoot, ".vscode");
    const settings = JSON.parse(
      await fs.readFile(path.join(vsDir, "settings.json"), "utf8"),
    );
    expect(settings["typescript.tsdk"]).toBe("node_modules/typescript/lib");

    const launch = JSON.parse(
      await fs.readFile(path.join(vsDir, "launch.json"), "utf8"),
    );
    for (const cfg of launch.configurations) {
      expect(cfg.runtimeExecutable).toBe("npx");
      expect(cfg.runtimeArgs.slice(0, 2)).toEqual(["playwright", "test"]);
    }

    const extensions = JSON.parse(
      await fs.readFile(path.join(vsDir, "extensions.json"), "utf8"),
    );
    expect(extensions.recommendations).toContain("ms-playwright.playwright");
  });

  it(
    "type-checks shared/fixtures.ts against the installed @playwright/test",
    async () => {
      const result = await run(
        "npx",
        ["tsc", "--noEmit", "-p", "tsconfig.json"],
        { cwd: projectRoot },
      );
      if (result.code !== 0) {
        throw new Error(
          `tsc --noEmit failed (${result.code}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
      }
      expect(result.code).toBe(0);
    },
    FIVE_MINUTES,
  );

  it(
    "runs a passing spec that imports the shared fixtures wrapper",
    async () => {
      const testFile = path.join(projectRoot, "tests", "smoke.spec.ts");
      await fs.writeFile(
        testFile,
        [
          'import { test, expect } from "../shared/fixtures";',
          "",
          'test("smoke @start-tracer", async ({ page }) => {',
          '  await page.goto("about:blank");',
          '  await expect(page).toHaveURL("about:blank");',
          "});",
          "",
        ].join("\n"),
      );

      const result = await run("npx", ["playwright", "test"], {
        cwd: projectRoot,
        // `@start-tracer` in the test title forces tracing on, so a clean
        // exit also proves BrowserManager.startTracing/stopTracing
        // executed end-to-end without throwing.
      });
      if (result.code !== 0) {
        throw new Error(
          `playwright test exited ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
      }
      expect(result.code).toBe(0);

      await fs.rm(testFile);
      await fs.rm(path.join(projectRoot, "test-results"), {
        recursive: true,
        force: true,
      });
      await fs.rm(path.join(projectRoot, "playwright-report"), {
        recursive: true,
        force: true,
      });
    },
    FIVE_MINUTES,
  );

  it(
    "captures a screenshot when a spec is forced to fail",
    async () => {
      const testFile = path.join(projectRoot, "tests", "fail.spec.ts");
      await fs.writeFile(
        testFile,
        [
          'import { test, expect } from "../shared/fixtures";',
          "",
          'test("forced failure", async ({ page }) => {',
          '  await page.goto("about:blank");',
          "  expect(false).toBe(true);",
          "});",
          "",
        ].join("\n"),
      );

      const result = await run("npx", ["playwright", "test"], {
        cwd: projectRoot,
      });
      // Expect non-zero because the spec asserts false.
      expect(result.code).not.toBe(0);

      // `screenshot: "only-on-failure"` in playwright.config.ts writes a
      // PNG under `test-results/<spec>/test-failed-1.png`.
      const resultsDir = path.join(projectRoot, "test-results");
      const files = await listFilesRecursive(resultsDir);
      const pngs = files.filter((f) => f.endsWith(".png"));
      if (pngs.length === 0) {
        throw new Error(
          `expected at least one screenshot under ${resultsDir}, found:\n${files.join("\n")}\nplaywright stdout:\n${result.stdout}\nplaywright stderr:\n${result.stderr}`,
        );
      }
      expect(pngs.length).toBeGreaterThan(0);

      await fs.rm(testFile);
      await fs.rm(resultsDir, { recursive: true, force: true });
      await fs.rm(path.join(projectRoot, "playwright-report"), {
        recursive: true,
        force: true,
      });
    },
    FIVE_MINUTES,
  );
});

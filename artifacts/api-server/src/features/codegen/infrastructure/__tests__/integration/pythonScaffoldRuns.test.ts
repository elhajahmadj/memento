import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { recorderConfig } from "@/features/projects/infrastructure/config";
import { createProject, setCurrentProject } from "@/features/projects/infrastructure/projectService";

/**
 * Smoke-runs the Python scaffold end to end:
 *
 *   1. Scaffolds a Python project via `createProject`.
 *   2. Installs the scaffolded project (and its runtime deps) into a
 *      private venv via `pip install -e .` — exactly what the README
 *      tells users to run. This locks in Task #19: the generated
 *      `pyproject.toml` must declare its packages explicitly so
 *      setuptools' auto-discovery doesn't reject the multi-package
 *      flat layout.
 *   3. Runs `pytest` against a passing test (asserts exit 0).
 *   4. Runs `pytest` against a forced-failing test (asserts non-zero exit
 *      AND that a screenshot landed under `test-results/`, which is the
 *      sole evidence the conftest hook actually executed).
 *
 * Gated behind `RUN_SCAFFOLD_INTEGRATION=1` because it requires Playwright
 * browser binaries (~120 MB download on a cold cache) and a working
 * `python3` + `pip` toolchain on PATH.
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

describe.skipIf(!RUN)("python scaffold runs end-to-end", () => {
  let tmp: string;
  let originalWorkspace: string;
  let venvPython: string;
  let projectRoot: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-pyrun-"));
    originalWorkspace = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;
    setCurrentProject(null);

    const project = await createProject({
      solutionName: "AcmePy",
      namespace: "acme.qa",
      language: "python",
    });
    projectRoot = project.rootPath;

    // Build a per-run virtualenv so we don't need write access to the
    // ambient Python and so we get a clean install of pytest-playwright.
    const venvDir = path.join(tmp, ".venv");
    const venvCreate = await run("python3", ["-m", "venv", venvDir], {
      cwd: tmp,
    });
    if (venvCreate.code !== 0) {
      throw new Error(
        `python3 -m venv failed (${venvCreate.code}):\n${venvCreate.stderr}`,
      );
    }
    venvPython = path.join(venvDir, "bin", "python");

    const pipUpgrade = await run(
      venvPython,
      ["-m", "pip", "install", "--upgrade", "pip", "--quiet"],
      { cwd: projectRoot },
    );
    if (pipUpgrade.code !== 0) {
      throw new Error(
        `pip upgrade failed (${pipUpgrade.code}):\n${pipUpgrade.stderr}`,
      );
    }

    const pipInstall = await run(
      venvPython,
      ["-m", "pip", "install", "-e", ".", "--quiet"],
      { cwd: projectRoot },
    );
    if (pipInstall.code !== 0) {
      throw new Error(
        `pip install -e . failed (${pipInstall.code}):\n${pipInstall.stderr}`,
      );
    }

    // Idempotent: a no-op when chromium is already on the local cache.
    const browserInstall = await run(
      venvPython,
      ["-m", "playwright", "install", "chromium"],
      { cwd: projectRoot },
    );
    if (browserInstall.code !== 0) {
      throw new Error(
        `playwright install chromium failed (${browserInstall.code}):\n${browserInstall.stderr}`,
      );
    }
  }, FIVE_MINUTES);

  afterAll(async () => {
    recorderConfig.workspaceDir = originalWorkspace;
    setCurrentProject(null);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("ships a working .vscode/ folder pointing at the pytest runner", async () => {
    // Task #32: smoke-test the VS Code config that ships with the
    // Python scaffold. This runs alongside the heavier scaffold tests
    // because they share the same `beforeAll` scaffolded project.
    const vsDir = path.join(projectRoot, ".vscode");
    const settings = JSON.parse(
      await fs.readFile(path.join(vsDir, "settings.json"), "utf8"),
    );
    expect(settings["python.testing.pytestEnabled"]).toBe(true);
    expect(settings["python.testing.pytestArgs"]).toEqual(["tests"]);

    const launch = JSON.parse(
      await fs.readFile(path.join(vsDir, "launch.json"), "utf8"),
    );
    for (const cfg of launch.configurations) {
      expect(cfg.module).toBe("pytest");
      expect(cfg.type).toBe("debugpy");
    }

    const extensions = JSON.parse(
      await fs.readFile(path.join(vsDir, "extensions.json"), "utf8"),
    );
    expect(extensions.recommendations).toContain("ms-python.python");
    expect(extensions.recommendations).toContain("ms-playwright.playwright");
  });

  it(
    "runs a passing test under pytest with the scaffolded conftest",
    async () => {
      // Tiny smoke test that exercises the autouse `_tracing` fixture
      // (which depends on `context` + `page` so a successful run proves
      // conftest imports + pytest-playwright wiring + BrowserManager
      // tracing helpers all resolve at runtime).
      const testFile = path.join(projectRoot, "tests", "test_smoke.py");
      await fs.writeFile(
        testFile,
        [
          "import os",
          "",
          "os.environ['START_TRACER'] = '1'",
          "",
          "",
          "def test_smoke(page):",
          "    page.goto('about:blank')",
          "    assert page.url == 'about:blank'",
          "",
        ].join("\n"),
      );

      const result = await run(venvPython, ["-m", "pytest", "-q"], {
        cwd: projectRoot,
        env: { START_TRACER: "1" },
      });
      if (result.code !== 0) {
        throw new Error(
          `pytest exited ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
      }
      expect(result.code).toBe(0);

      // Tracing was forced on; the conftest tear-down should have
      // produced a trace zip via PlaywrightTraceExtensions.
      const tracesDir = path.join(projectRoot, "playwright-traces");
      const traceFiles = await listFilesRecursive(tracesDir);
      // It's acceptable for the trace upload hook to skip writing when
      // running in "Local" mode — but BrowserManager.start_tracing /
      // stop_tracing must not have thrown (which would have failed the
      // test above with exit != 0). The trace zip is best-effort, so
      // we only soft-assert: if any file was produced, it must be a
      // .zip. We do NOT require traceFiles.length > 0 because the
      // upload path is deliberately a no-op in Local env.
      for (const f of traceFiles) {
        expect(f.endsWith(".zip")).toBe(true);
      }

      await fs.rm(testFile);
    },
    FIVE_MINUTES,
  );

  it(
    "captures a screenshot when a test is forced to fail",
    async () => {
      const testFile = path.join(projectRoot, "tests", "test_force_fail.py");
      await fs.writeFile(
        testFile,
        [
          "def test_force_fail(page):",
          "    page.goto('about:blank')",
          "    assert False, 'forced failure to verify screenshot capture'",
          "",
        ].join("\n"),
      );

      const result = await run(venvPython, ["-m", "pytest", "-q"], {
        cwd: projectRoot,
      });
      // We expect pytest to fail (non-zero) because of the forced assert.
      expect(result.code).not.toBe(0);

      // The screenshot-on-failure hook in conftest writes
      // `test-results/<test_name>_<timestamp>.png`. Its presence is
      // the evidence that `pytest_runtest_makereport` ran AND that
      // BrowserManager.take_screenshot worked against a real Page.
      const resultsDir = path.join(projectRoot, "test-results");
      const files = await listFilesRecursive(resultsDir);
      const pngs = files.filter((f) => f.endsWith(".png"));
      if (pngs.length === 0) {
        throw new Error(
          `expected at least one screenshot under ${resultsDir}, found:\n${files.join("\n")}\npytest stdout:\n${result.stdout}\npytest stderr:\n${result.stderr}`,
        );
      }
      expect(pngs.length).toBeGreaterThan(0);

      await fs.rm(testFile);
      await fs.rm(resultsDir, { recursive: true, force: true });
    },
    FIVE_MINUTES,
  );
});

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
import { PYTHON_DEFAULT_ARCHITECTURE_ID } from "@/features/architectures/infrastructure/architectureService";

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
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-pyscaff-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
  setCurrentProject(null);
});

afterEach(async () => {
  recorderConfig.workspaceDir = originalWorkspace;
  setCurrentProject(null);
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("createProject with python-default architecture", () => {
  it("emits a flat python tree with pyproject.toml as the project marker", async () => {
    const project = await createProject({
      solutionName: "AcmePy",
      namespace: "acme.qa",
      language: "python",
    });

    expect(project.language).toBe("python");
    expect(project.solutionName).toBe("AcmePy");
    // Solution `AcmePy` → snake_case package `acme_py` → tests pkg `acme_py_tests`.
    expect(project.testProjectName).toBe("acme_py_tests");
    expect(project.rootPath).toBe(path.join(tmp, "AcmePy"));
    // Python projects re-use `slnPath` to point at the root pyproject.toml
    // so the rest of the API surface (which keys projects by slnPath)
    // keeps working unchanged.
    expect(project.slnPath).toBe(path.join(tmp, "AcmePy", "pyproject.toml"));

    const root = project.rootPath;
    expect(await exists(path.join(root, "pyproject.toml"))).toBe(true);
    // Conftest + the package skeleton come from the python-default arch.
    expect(await exists(path.join(root, "conftest.py"))).toBe(true);
    expect(await exists(path.join(root, "tests"))).toBe(true);
    // Task #34: a sample `tests/test_smoke.py` ships in `tests/` so a
    // freshly downloaded scaffold has something for pytest (and the F5
    // launch profiles) to actually run. Without it a clean download
    // surfaces "no tests collected" on the first F5, which is a
    // confusing first impression for the IDE-first flow.
    const smokeTestPath = path.join(root, "tests", "test_smoke.py");
    expect(await exists(smokeTestPath)).toBe(true);
    const smokeTest = await fs.readFile(smokeTestPath, "utf8");
    // Uses the `page` fixture from pytest-playwright and visits
    // about:blank so the sample never makes a network call — F5 on a
    // clean download produces a green run without any setup beyond
    // `pip install -e .` + `playwright install`.
    expect(smokeTest).toContain("def test_smoke(page: Page)");
    expect(smokeTest).toContain('"about:blank"');
    expect(await exists(path.join(root, "pages", "selectors"))).toBe(true);
    expect(await exists(path.join(root, "pages", "actions"))).toBe(true);
    expect(await exists(path.join(root, "shared"))).toBe(true);
    // .env.example is part of the C#-parity scaffold so users can opt in
    // to env-driven config + tracing without hunting for the right keys.
    expect(await exists(path.join(root, ".env.example"))).toBe(true);

    // Feature parity with the C# default architecture (Task #6): the
    // shared helpers and the infrastructure base classes must be on
    // disk, not just placeholder files.
    expect(
      await exists(path.join(root, "shared", "test_config.py")),
    ).toBe(true);
    expect(await exists(path.join(root, "shared", "constants.py"))).toBe(
      true,
    );
    expect(
      await exists(path.join(root, "shared", "test_context_helper.py")),
    ).toBe(true);
    expect(
      await exists(path.join(root, "shared", "test_output_logger.py")),
    ).toBe(true);
    expect(
      await exists(path.join(root, "shared", "test_tracker.py")),
    ).toBe(true);
    expect(
      await exists(path.join(root, "shared", "app_configuration.py")),
    ).toBe(true);
    expect(
      await exists(
        path.join(root, "shared", "playwright_trace_extensions.py"),
      ),
    ).toBe(true);
    expect(
      await exists(path.join(root, "infrastructure", "test_fixture_base.py")),
    ).toBe(true);
    expect(
      await exists(path.join(root, "infrastructure", "browser_manager.py")),
    ).toBe(true);

    // BrowserManager is a real class with start/stop tracing helpers,
    // not just a thin wrapper. We assert on the public method names so
    // a regression of "BrowserManager went back to a stub" is caught.
    const browserManager = await fs.readFile(
      path.join(root, "infrastructure", "browser_manager.py"),
      "utf8",
    );
    expect(browserManager).toContain("class BrowserManager");
    expect(browserManager).toContain("def start_tracing(");
    expect(browserManager).toContain("def stop_tracing(");
    expect(browserManager).toContain("def take_screenshot(");

    // conftest must wire up screenshot-on-failure + tracing hooks; the
    // hook function name is part of pytest's contract so this assertion
    // is intentionally specific.
    const conftest = await fs.readFile(
      path.join(root, "conftest.py"),
      "utf8",
    );
    expect(conftest).toContain("def pytest_runtest_makereport(");
    expect(conftest).toContain("BrowserManager");
    expect(conftest).toContain("START_TRACER");

    // Marker stores language so a re-load picks the right code path.
    const marker = JSON.parse(
      await fs.readFile(path.join(root, ".testbuilder.json"), "utf8"),
    );
    expect(marker.language).toBe("python");
    expect(marker.architectureId).toBe(PYTHON_DEFAULT_ARCHITECTURE_ID);

    // Task #32: a freshly downloaded Python scaffold opens in VS Code
    // with the pytest runner pre-wired. Assert the three files exist
    // with non-empty, JSON-parseable content and that launch.json
    // references the pytest runner the conftest expects.
    const settingsPath = path.join(root, ".vscode", "settings.json");
    const launchPath = path.join(root, ".vscode", "launch.json");
    const extensionsPath = path.join(root, ".vscode", "extensions.json");
    expect(await exists(settingsPath)).toBe(true);
    expect(await exists(launchPath)).toBe(true);
    expect(await exists(extensionsPath)).toBe(true);

    const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    expect(settings["python.testing.pytestEnabled"]).toBe(true);
    expect(settings["python.testing.pytestArgs"]).toEqual(["tests"]);
    // Cross-platform: rely on the Python extension's venv auto-discovery
    // rather than hard-coding a POSIX-only `defaultInterpreterPath`.
    // `python.venvPath` + `python.venvFolders` works on Windows AND POSIX
    // because the extension picks the right binary inside `.venv/`.
    expect(settings["python.venvPath"]).toBe("${workspaceFolder}");
    expect(settings["python.venvFolders"]).toEqual([".venv", "venv"]);
    expect(settings["python.defaultInterpreterPath"]).toBeUndefined();
    expect(settings["python.terminal.activateEnvironment"]).toBe(true);

    const launch = JSON.parse(await fs.readFile(launchPath, "utf8"));
    expect(Array.isArray(launch.configurations)).toBe(true);
    const launchNames = launch.configurations.map(
      (c: { name: string }) => c.name,
    );
    expect(launchNames).toContain("Pytest: current file");
    expect(launchNames).toContain("Pytest: all tests");
    for (const cfg of launch.configurations) {
      // Both configs must invoke pytest as a module so conftest.py
      // (screenshot-on-failure + tracing) is honored end-to-end.
      expect(cfg.module).toBe("pytest");
      expect(cfg.type).toBe("debugpy");
    }

    const extensions = JSON.parse(await fs.readFile(extensionsPath, "utf8"));
    expect(extensions.recommendations).toContain("ms-python.python");
    expect(extensions.recommendations).toContain("ms-playwright.playwright");
  });

  it("rehydrates language: 'python' when re-loaded from disk", async () => {
    const created = await createProject({
      solutionName: "AcmePy",
      namespace: "acme.qa",
      language: "python",
    });
    setCurrentProject(null);

    const reloaded = await loadProject(created.slnPath);
    expect(reloaded.language).toBe("python");
    expect(reloaded.solutionName).toBe("AcmePy");
    expect(reloaded.rootPath).toBe(created.rootPath);
  });
});

describe("createProject without language (default csharp)", () => {
  it("preserves the legacy csharp behavior when no language hint is given", async () => {
    const project = await createProject({
      solutionName: "AcmeSln",
      namespace: "Acme.QA",
    });
    expect(project.language).toBe("csharp");
    expect(path.basename(project.slnPath)).toBe("AcmeSln.sln");
  });
});

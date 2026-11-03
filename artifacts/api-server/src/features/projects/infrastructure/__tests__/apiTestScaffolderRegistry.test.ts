import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  getApiTestScaffolder,
  PYTHON_PROJECT_FILE,
  NODEJS_PROJECT_FILE,
  JAVA_PROJECT_FILE,
} from "@/features/projects/infrastructure/apiTestScaffolderRegistry";

let tmp: string;
let originalWorkspace: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "api-scaffold-registry-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("getApiTestScaffolder", () => {
  it("csharp adapter delegates to scaffoldApiCsharp and writes the .sln", async () => {
    const scaffolder = getApiTestScaffolder("csharp");
    expect(scaffolder.isImplemented).toBe(true);
    const result = await scaffolder.scaffold("Sample", "Sample");
    expect(path.basename(result.slnPath)).toBe("Sample.sln");
    await fs.access(result.slnPath);
    await fs.access(path.join(result.rootPath, "Sample.Automation.API"));
  });

  it("python adapter writes a real pytest + httpx layout", async () => {
    const scaffolder = getApiTestScaffolder("python");
    expect(scaffolder.isImplemented).toBe(true);
    const result = await scaffolder.scaffold("Sample", "Sample");
    expect(path.basename(result.slnPath)).toBe(PYTHON_PROJECT_FILE);
    expect(result.helperProjectName).toBe("automation_api");
    expect(result.testProjectName).toBe("tests");
    await fs.access(path.join(result.rootPath, "pyproject.toml"));
    await fs.access(path.join(result.rootPath, "conftest.py"));
    await fs.access(
      path.join(result.rootPath, "automation_api", "constants", "api_endpoints.py"),
    );
    await fs.access(path.join(result.rootPath, "tests", "appsettings.json"));
    await fs.access(
      path.join(result.rootPath, "tests", "infrastructure", "api_test_collection.py"),
    );
    await fs.access(
      path.join(result.rootPath, "tests", "api_testing_assistants", "__init__.py"),
    );
    await fs.access(path.join(result.rootPath, "tests", "tests", "__init__.py"));
    // Handler filenames + class names match the cross-language contract.
    await fs.access(
      path.join(result.rootPath, "automation_api", "handlers", "retry_handler.py"),
    );
    await fs.access(
      path.join(
        result.rootPath,
        "automation_api",
        "handlers",
        "http_logging_handler.py",
      ),
    );
    const retry = await fs.readFile(
      path.join(result.rootPath, "automation_api", "handlers", "retry_handler.py"),
      "utf8",
    );
    expect(retry).toContain("class RetryHandler");
    const httpLog = await fs.readFile(
      path.join(
        result.rootPath,
        "automation_api",
        "handlers",
        "http_logging_handler.py",
      ),
      "utf8",
    );
    expect(httpLog).toContain("class HttpLoggingHandler");
    // Root conftest.py registers the api_fixture module so generated
    // tests can request `api_fixture` without per-file imports.
    const conftest = await fs.readFile(
      path.join(result.rootPath, "conftest.py"),
      "utf8",
    );
    expect(conftest).toMatch(
      /pytest_plugins\s*=\s*\(\s*"tests\.infrastructure\.api_test_collection"\s*,?\s*\)/,
    );
    // pyproject.toml configures pytest collection so that generated
    // `{ClassName}Tests` classes are discoverable.
    const pyproject = await fs.readFile(
      path.join(result.rootPath, "pyproject.toml"),
      "utf8",
    );
    expect(pyproject).toMatch(/python_classes\s*=\s*\[[^\]]*"\*Tests"/);
  });

  it.each([] as Array<readonly [never, never]>)(
    "%s stub adapter writes only the marker file (no helper / tests dirs)",
    async (lang, markerFile) => {
      const scaffolder = getApiTestScaffolder(lang);
      expect(scaffolder.isImplemented).toBe(false);
      const result = await scaffolder.scaffold("Sample", "Sample");
      expect(path.basename(result.slnPath)).toBe(markerFile);
      const entries = await fs.readdir(result.rootPath);
      expect(entries).toContain(markerFile);
      expect(entries).not.toContain("Sample.Automation.API");
      expect(entries).not.toContain("Sample.Automation.API.Tests");
      expect(entries).not.toContain("Sample.sln");
    },
  );

  it("java adapter delegates to scaffoldApiJava and writes the Maven multi-module layout", async () => {
    const scaffolder = getApiTestScaffolder("java");
    expect(scaffolder.isImplemented).toBe(true);
    const result = await scaffolder.scaffold("Sample", "Sample");
    expect(path.basename(result.slnPath)).toBe(JAVA_PROJECT_FILE);
    expect(result.helperProjectName).toBe("Sample-automation-api");
    expect(result.testProjectName).toBe("Sample-automation-api-tests");
    await fs.access(result.slnPath);
    await fs.access(
      path.join(result.rootPath, "Sample-automation-api", "pom.xml"),
    );
    await fs.access(
      path.join(
        result.rootPath,
        "Sample-automation-api-tests",
        "src",
        "test",
        "resources",
        "appsettings.json",
      ),
    );
  });

  it("nodejs adapter writes the full Vitest helper + tests layout", async () => {
    const scaffolder = getApiTestScaffolder("nodejs");
    expect(scaffolder.isImplemented).toBe(true);
    const result = await scaffolder.scaffold("Sample", "Sample");
    expect(path.basename(result.slnPath)).toBe(NODEJS_PROJECT_FILE);
    expect(result.testProjectName).toBe("tests");
    await fs.access(
      path.join(
        result.rootPath,
        "src",
        "automation-api",
        "constants",
        "api-endpoints.ts",
      ),
    );
    await fs.access(
      path.join(
        result.rootPath,
        "src",
        "automation-api",
        "infrastructure",
        "api-test-fixture.ts",
      ),
    );
    await fs.access(path.join(result.rootPath, "tests", "appsettings.json"));
    await fs.access(
      path.join(
        result.rootPath,
        "tests",
        "infrastructure",
        "api-test-collection.ts",
      ),
    );
    await fs.access(
      path.join(result.rootPath, "tests", "api-testing-assistants"),
    );
    await fs.access(path.join(result.rootPath, "tests", "tests"));
  });
});
